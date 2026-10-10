import { checkAccess } from "../_shared/access.ts";
import { ApprovalError, decideTask } from "../_shared/approval.ts";
import { AUTH_ERROR_MESSAGES, authenticateCaller, type CallerConfig } from "../_shared/caller.ts";
import type { ExecuteGoogleAction, TaskIntent } from "../_shared/contracts.ts";
import { type ActionIntent, prepareAction } from "../_shared/email/actions.ts";
import { log } from "../_shared/log.ts";
import { WRITE_INTENTS } from "../_shared/policy.ts";
import { readBack, speakable } from "../_shared/readback.ts";
import type { AgentTask } from "../_shared/db.ts";
import { createAndSubmitTask, createApprovalTask, type TaskDeps } from "../_shared/tasks.ts";
import { stringArg, type ToolHandler, vapiToolEndpoint } from "../_shared/vapi.ts";

const INTENTS: TaskIntent[] = ["research", "summarize_emails", "calendar", "reply_email", "send_email", "create_calendar_event"];
const MAX_INSTRUCTION_LENGTH = 2000;

export type CreateTaskDeps = TaskDeps & { executeAction: ExecuteGoogleAction };
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

    // Risk assessment → required layers; L3 verification question if needed.
    const access = await checkAccess(deps, req, auth, intent, params, stringArg(call.args, "verification_answer"));
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

    // L4: write actions wait for the owner's approval of the exact action: read back
    // on this call and confirmed (decide_action), or in the Alo app.
    if (access.required.includes("approval") && action?.ok) {
      const task = await createApprovalTask(deps, newTask, action.summary);
      return { toolCallId: call.id, result: await reviewInstructions(task, req.callId) };
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
        result: `Drafting the reply (reference ${ref}). It takes a few minutes; nothing is sent before the caller approves it. ` +
          'To approve, they call Alo again and say "approve my pending email" (or approve it in the Alo app). The caller can hang up now.',
      };
    }
    return {
      toolCallId: call.id,
      result: submitted
        ? `Task accepted (reference ${ref}). The agent keeps working after the call; the result will appear in the Alo app's History and, if Gmail is connected, in the caller's inbox. The caller can hang up now.`
        : `Task saved (reference ${ref}) but the agent couldn't start it yet. It will retry automatically; the result will appear in the Alo app.`,
    };
  };

  /** L4 on this call: remember what is read back, and tell the assistant to read it exactly. */
  async function reviewInstructions(task: AgentTask, callId: string): Promise<string> {
    const ref = task.id.slice(0, 4).toUpperCase();
    if (!speakable(task)) {
      return `Saved (reference ${ref}), nothing sent. It is too long to approve by phone: the caller can approve it in the Alo app.`;
    }
    await deps.store.setReviewTask(callId, task.id);
    return `Nothing has been sent yet (reference ${ref}). Read this to the caller exactly, word for word: "${readBack(task)}" ` +
      'Then ask: "Shall I send it?" Call decide_action with decision approve only if they clearly say yes, ' +
      "or reject if they say no. If they want changes, reject it and take the new request.";
  }

  /**
   * L4 by voice. Without a decision: read back the latest action waiting for approval
   * (e.g. a reply draft finished after the call). With a decision: approve/reject
   * exactly the action that was read back on this call. Both need L1–L3 on this call.
   */
  const decideAction: ToolHandler = async (call, req) => {
    const auth = await authenticateCaller(deps.store, config.caller, req, stringArg(call.args, "pin"));
    if (!auth.ok) return { toolCallId: call.id, error: AUTH_ERROR_MESSAGES[auth.reason] };
    const decision = stringArg(call.args, "decision");
    const session = await deps.store.getCallSession(req.callId);

    const task = decision
      ? (session?.review_task_id ? await deps.store.getTask(session.review_task_id) : null)
      : await deps.store.latestAwaitingApproval(auth.profile.user_id);
    if (!task || task.user_id !== auth.profile.user_id) {
      return {
        toolCallId: call.id,
        result: decision
          ? "Nothing was read back on this call yet. Call decide_action without a decision first."
          : "Nothing is waiting for the caller's approval.",
      };
    }

    // Approving sends something: the same layers as a high-risk request (incl. L3).
    const access = await checkAccess(deps, req, auth, task.intent, task.params, stringArg(call.args, "verification_answer"));
    if (!access.ok) return { toolCallId: call.id, result: access.message };

    if (!decision) return { toolCallId: call.id, result: await reviewInstructions(task, req.callId) };
    if (decision !== "approve" && decision !== "reject") {
      return { toolCallId: call.id, error: 'Argument "decision" must be "approve" or "reject".' };
    }
    try {
      const { status } = await decideTask(deps, {
        taskId: task.id,
        userId: auth.profile.user_id,
        approve: decision === "approve",
        via: "call",
      });
      await deps.store.setReviewTask(req.callId, null);
      return {
        toolCallId: call.id,
        result: status === "completed" ? "Done: it was sent. Tell the caller." : "Cancelled; nothing was sent. Tell the caller.",
      };
    } catch (err) {
      if (err instanceof ApprovalError) return { toolCallId: call.id, error: `${err.message} Tell the caller.` };
      throw err;
    }
  };

  return vapiToolEndpoint(config.vapiSecret, { create_task: createTask, decide_action: decideAction });
}
