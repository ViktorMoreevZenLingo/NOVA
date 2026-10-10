import { checkAccess } from "../_shared/access.ts";
import { ApprovalError, decideTask } from "../_shared/approval.ts";
import { requestApprovalCall } from "../_shared/approval-call.ts";
import { AUTH_ERROR_MESSAGES, authenticateCaller, type CallerConfig } from "../_shared/caller.ts";
import type { ExecuteGoogleAction, TaskIntent } from "../_shared/contracts.ts";
import { type ActionIntent, prepareAction } from "../_shared/email/actions.ts";
import { log } from "../_shared/log.ts";
import { WRITE_INTENTS } from "../_shared/policy.ts";
import { createAndSubmitTask, createApprovalTask, type TaskDeps } from "../_shared/tasks.ts";
import { stringArg, type ToolHandler, vapiToolEndpoint } from "../_shared/vapi.ts";
import type { VapiApi } from "../_shared/vapi-api.ts";

const INTENTS: TaskIntent[] = ["research", "summarize_emails", "calendar", "reply_email", "send_email", "create_calendar_event"];
const MAX_INSTRUCTION_LENGTH = 2000;

export type CreateTaskDeps = TaskDeps & { vapiApi: VapiApi | null; executeAction: ExecuteGoogleAction };
export type CreateTaskConfig = { vapiSecret: string; caller: CallerConfig };

/** Intent-specific parameters for read intents (write intents go through prepareAction). */
function readParams(intent: TaskIntent, args: Record<string, unknown>): Record<string, unknown> {
  if (intent === "summarize_emails" || intent === "reply_email") {
    const q = stringArg(args, "email_query");
    return q ? { email_query: q } : {};
  }
  if (intent === "calendar") {
    const days = Number(stringArg(args, "days_ahead"));
    return Number.isFinite(days) && days > 0 ? { days_ahead: days } : {};
  }
  return {};
}

export function createTaskHandler(deps: CreateTaskDeps, config: CreateTaskConfig) {
  const createTask: ToolHandler = async (call, req) => {
    const intent = stringArg(call.args, "intent") as TaskIntent | undefined;
    const instruction = stringArg(call.args, "instruction");
    if (!intent || !INTENTS.includes(intent)) {
      return { toolCallId: call.id, error: `Argument "intent" must be one of: ${INTENTS.join(", ")}.` };
    }
    if (!instruction || instruction.length > MAX_INSTRUCTION_LENGTH) {
      return { toolCallId: call.id, error: `Argument "instruction" is required (max ${MAX_INSTRUCTION_LENGTH} characters).` };
    }

    const isWrite = WRITE_INTENTS.has(intent);
    const action = isWrite ? prepareAction(intent as ActionIntent, call.args) : null;
    if (action && !action.ok) return { toolCallId: call.id, error: action.error };
    const params = action?.ok ? action.params : readParams(intent, call.args);

    // L1 caller ID + L2 PIN
    const auth = await authenticateCaller(deps.store, config.caller, req, stringArg(call.args, "pin"));
    if (!auth.ok) {
      log.warn("create_task.auth_failed", { callId: req.callId, reason: auth.reason });
      return { toolCallId: call.id, error: AUTH_ERROR_MESSAGES[auth.reason] };
    }

    // Risk assessment → required layers; L3 callback if missing.
    const access = await checkAccess(deps, req, auth, intent, params);
    if (!access.ok) return { toolCallId: call.id, result: access.message };

    const newTask = {
      user_id: auth.profile.user_id,
      vapi_call_id: req.callId,
      vapi_tool_call_id: call.id,
      intent,
      prompt: instruction,
      params,
      risk_level: access.assessment.risk,
      layers: access.satisfied,
    };

    // L4: write actions wait for the owner's approval. Not on this call: right after
    // it, Alo calls the registered number back, reads the action and asks for the PIN
    // (works without internet). The Alo app can approve it too.
    if (access.required.includes("approval") && action?.ok) {
      const task = await createApprovalTask(deps, newTask, action.summary);
      const ref = task.id.slice(0, 4).toUpperCase();
      return {
        toolCallId: call.id,
        result: `Saved (reference ${ref}). Nothing has been sent yet. Right after this call Alo will call the caller back on ` +
          "their registered number, read it to them and ask for their PIN to approve (they can also approve it in the Alo app). " +
          "Tell them that, ask if there is anything else, then end the call.",
      };
    }

    // Reads, and reply drafts (Manus writes the text; sending then waits for L4 approval).
    const { task, submitted } = await createAndSubmitTask(deps, newTask);
    log.info("create_task.done", { callId: req.callId, taskId: task.id, submitted, risk: access.assessment.risk });

    const ref = task.id.slice(0, 4).toUpperCase();
    if (task.status === "failed") {
      return { toolCallId: call.id, error: `The task could not be started: ${task.error_message ?? "unknown reason"}` };
    }
    if (intent === "reply_email" && submitted) {
      return {
        toolCallId: call.id,
        result: `Drafting the reply (reference ${ref}). When the draft is ready, usually within a few minutes, Alo will call the ` +
          "caller back to read it and ask for their PIN to send it (or they can approve it in the Alo app). Nothing is sent " +
          "before that. The caller can hang up now.",
      };
    }
    return {
      toolCallId: call.id,
      result: submitted
        ? `Task accepted (reference ${ref}). The agent keeps working after the call; the result will appear in the Alo app's History and, if Gmail is connected, in the caller's inbox. The caller can hang up now.`
        : `Task saved (reference ${ref}) but the agent couldn't start it yet. It will retry automatically; the result will appear in the Alo app.`,
    };
  };

  /**
   * On a confirmation call: approve/reject the action that was read aloud (PIN required).
   * On any other call: (re)start the confirmation call for the latest pending action.
   */
  const decideAction: ToolHandler = async (call, req) => {
    const auth = await authenticateCaller(deps.store, config.caller, req, stringArg(call.args, "pin"));
    if (!auth.ok) return { toolCallId: call.id, error: AUTH_ERROR_MESSAGES[auth.reason] };
    let session = await deps.store.getCallSession(req.callId);
    const meta = req.callMetadata;
    if (
      session?.purpose !== "approval" && req.callType === "outboundPhoneCall" && meta.purpose === "approval" &&
      typeof meta.taskId === "string"
    ) {
      // Session row missing (write failed or user answered first): rebuild it from the
      // metadata we set on our own outbound call. decideTask still checks the owner.
      await deps.store.createCallbackSession(req.callId, auth.profile.user_id, { purpose: "approval", approvalTaskId: meta.taskId });
      session = await deps.store.getCallSession(req.callId);
    }

    if (session?.purpose === "approval" && session.approval_task_id) {
      const decision = stringArg(call.args, "decision");
      if (decision !== "approve" && decision !== "reject") {
        return { toolCallId: call.id, error: 'Argument "decision" must be "approve" or "reject".' };
      }
      if (decision === "approve" && !auth.pinNow) {
        return { toolCallId: call.id, error: AUTH_ERROR_MESSAGES.pin_required };
      }
      try {
        const { status } = await decideTask(deps, {
          taskId: session.approval_task_id,
          userId: auth.profile.user_id,
          approve: decision === "approve",
          via: "call",
        });
        return {
          toolCallId: call.id,
          result: status === "completed"
            ? "Done: it was sent. Tell the caller, then end the call."
            : "Cancelled; nothing was sent. Tell the caller, then end the call.",
        };
      } catch (err) {
        if (err instanceof ApprovalError) return { toolCallId: call.id, error: `${err.message} Tell the caller, then end the call.` };
        throw err;
      }
    }

    const pending = await deps.store.latestAwaitingApproval(auth.profile.user_id);
    if (!pending) return { toolCallId: call.id, result: "Nothing is waiting for the caller's approval." };
    const started = await requestApprovalCall(deps, pending, { minGapMinutes: 1 });
    return {
      toolCallId: call.id,
      result: started
        ? "Alo will call the caller back right away on their registered number to read the pending action and confirm it. Tell them, then end this call."
        : "A confirmation call can't be placed right now (too many attempts or not configured). The caller can approve it in the Alo app.",
    };
  };

  return vapiToolEndpoint(config.vapiSecret, { create_task: createTask, decide_action: decideAction });
}
