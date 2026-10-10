import { AUTH_ERROR_MESSAGES, authenticateCaller, type CallerConfig } from "../_shared/caller.ts";
import type { AgentTask, TaskStore } from "../_shared/db.ts";
import { stringArg, type ToolHandler, vapiToolEndpoint } from "../_shared/vapi.ts";

export type GetTaskStatusConfig = { vapiSecret: string; caller: CallerConfig };

const SPOKEN_STATUS: Record<AgentTask["status"], string> = {
  pending: "is being started",
  submitted: "is still in progress",
  submit_failed: "hasn't started yet; it will be retried automatically",
  completed: "is complete; the result is in the Alo app's History",
  needs_input: "is paused because the agent needs more information; details are in the Alo app's History",
  failed: "could not be completed",
};

export function getTaskStatusHandler(store: TaskStore, config: GetTaskStatusConfig) {
  const getTaskStatus: ToolHandler = async (call, req) => {
    const auth = await authenticateCaller(store, config.caller, req, stringArg(call.args, "pin"));
    if (!auth.ok) return { toolCallId: call.id, error: AUTH_ERROR_MESSAGES[auth.reason] };

    const task = await store.latestTaskForUser(auth.profile.user_id);
    if (!task) return { toolCallId: call.id, result: "The caller has no tasks yet." };

    const ref = task.id.slice(0, 4).toUpperCase();
    // Result content stays out of the voice channel; it goes by email.
    return {
      toolCallId: call.id,
      result: `The latest task (reference ${ref}: "${task.prompt.slice(0, 80)}") ${SPOKEN_STATUS[task.status]}.`,
    };
  };

  return vapiToolEndpoint(config.vapiSecret, { get_task_status: getTaskStatus });
}
