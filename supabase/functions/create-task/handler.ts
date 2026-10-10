import { AUTH_ERROR_MESSAGES, authenticateCaller, type CallerConfig } from "../_shared/caller.ts";
import type { TaskIntent } from "../_shared/contracts.ts";
import { log } from "../_shared/log.ts";
import { createAndSubmitTask, type TaskDeps } from "../_shared/tasks.ts";
import { stringArg, type ToolHandler, vapiToolEndpoint } from "../_shared/vapi.ts";

const INTENTS: TaskIntent[] = ["summarize_emails", "research"];
const MAX_INSTRUCTION_LENGTH = 2000;

export type CreateTaskConfig = { vapiSecret: string; caller: CallerConfig };

export function createTaskHandler(deps: TaskDeps, config: CreateTaskConfig) {
  const createTask: ToolHandler = async (call, req) => {
    const intent = stringArg(call.args, "intent") as TaskIntent | undefined;
    const instruction = stringArg(call.args, "instruction");
    if (!intent || !INTENTS.includes(intent)) {
      return { toolCallId: call.id, error: `Argument "intent" must be one of: ${INTENTS.join(", ")}.` };
    }
    if (!instruction || instruction.length > MAX_INSTRUCTION_LENGTH) {
      return { toolCallId: call.id, error: `Argument "instruction" is required (max ${MAX_INSTRUCTION_LENGTH} characters).` };
    }

    const auth = await authenticateCaller(deps.store, config.caller, req, stringArg(call.args, "pin"));
    if (!auth.ok) {
      log.warn("create_task.auth_failed", { callId: req.callId, reason: auth.reason });
      return { toolCallId: call.id, error: AUTH_ERROR_MESSAGES[auth.reason] };
    }

    const { task, submitted } = await createAndSubmitTask(deps, {
      user_id: auth.profile.user_id,
      vapi_call_id: req.callId,
      vapi_tool_call_id: call.id,
      intent,
      prompt: instruction,
    });
    log.info("create_task.done", { callId: req.callId, taskId: task.id, submitted });

    const ref = task.id.slice(0, 4).toUpperCase();
    if (task.status === "failed") {
      return { toolCallId: call.id, error: `The task could not be started: ${task.error_message ?? "unknown reason"}` };
    }
    return {
      toolCallId: call.id,
      result: submitted
        ? `Task accepted (reference ${ref}). The agent keeps working after the call; the result will appear in the Alo app's History and, if Gmail is connected, in the caller's inbox. The caller can hang up now.`
        : `Task saved (reference ${ref}) but the agent couldn't start it yet. It will retry automatically; the result will appear in the Alo app.`,
    };
  };

  return vapiToolEndpoint(config.vapiSecret, { create_task: createTask });
}
