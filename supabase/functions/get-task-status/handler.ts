import { checkAccess } from "../_shared/access.ts";
import { AUTH_ERROR_MESSAGES, authenticateCaller, type CallerConfig } from "../_shared/caller.ts";
import type { AgentTask, TaskStore } from "../_shared/db.ts";
import { stringArg, type ToolHandler, vapiToolEndpoint } from "../_shared/vapi.ts";
import type { VapiApi } from "../_shared/vapi-api.ts";

export type GetTaskStatusConfig = { vapiSecret: string; caller: CallerConfig };

const SPOKEN_STATUS: Record<AgentTask["status"], string> = {
  pending: "is being started",
  submitted: "is still in progress",
  submit_failed: "hasn't started yet; it will be retried automatically",
  completed: "is complete; the result is in the Alo app's History",
  needs_input: "is paused because the agent needs more information; details are in the Alo app's History",
  failed: "could not be completed",
  awaiting_approval:
    "is ready and waiting for the caller's approval; nothing has been sent yet. Offer to call them back to read it and confirm (decide_action), or they can approve it in the Alo app",
  sending: "was approved and is being sent right now",
  rejected: "was rejected in the app; nothing was sent",
};

export function getTaskStatusHandler(deps: { store: TaskStore; vapiApi: VapiApi | null }, config: GetTaskStatusConfig) {
  const getTaskStatus: ToolHandler = async (call, req) => {
    const auth = await authenticateCaller(deps.store, config.caller, req, stringArg(call.args, "pin"));
    if (!auth.ok) return { toolCallId: call.id, error: AUTH_ERROR_MESSAGES[auth.reason] };

    const access = await checkAccess(deps, req, auth, "status");
    if (!access.ok) return { toolCallId: call.id, result: access.message };

    const task = await deps.store.latestTaskForUser(auth.profile.user_id);
    if (!task) return { toolCallId: call.id, result: "The caller has no tasks yet." };

    const ref = task.id.slice(0, 4).toUpperCase();
    // Result content stays out of the voice channel; it is in the app.
    return {
      toolCallId: call.id,
      result: `The latest task (reference ${ref}: "${task.prompt.slice(0, 80)}") ${SPOKEN_STATUS[task.status]}.`,
    };
  };

  return vapiToolEndpoint(config.vapiSecret, { get_task_status: getTaskStatus });
}
