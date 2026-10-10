// Backstop for everything asynchronous: missed webhooks, failed Manus
// submissions and failed notifications. Triggered by pg_cron every 5 minutes.
import { hasBearer } from "../_shared/crypto.ts";
import type { AgentTask } from "../_shared/db.ts";
import { errorText, log } from "../_shared/log.ts";
import { applyManusStop, failTask, MAX_SUBMIT_ATTEMPTS, notifyTask, submitTask, type TaskDeps } from "../_shared/tasks.ts";

export type ReconcileConfig = { cronSecret: string; staleAfterMs?: number };

const DEFAULT_STALE_AFTER_MS = 3 * 60_000;

async function reconcileTask(deps: TaskDeps, task: AgentTask): Promise<string> {
  switch (task.status) {
    case "pending":
    case "submit_failed":
      if (task.submit_attempts >= MAX_SUBMIT_ATTEMPTS) {
        await failTask(deps, task.id, ["pending", "submit_failed"], "Could not start the task after several attempts.");
        return "failed";
      }
      return (await submitTask(deps, task)) ? "resubmitted" : "resubmit_failed";

    case "submitted":
    case "needs_input": {
      // needs_input: the user may have continued in the Manus UI and the
      // completion webhook was missed.
      if (!task.manus_task_id) return "skipped";
      const detail = await deps.manus.getTask(task.manus_task_id);
      if (detail.status === "stopped") {
        await applyManusStop(deps, task.manus_task_id, { stopReason: "finish", taskUrl: detail.task_url });
        return "completed";
      }
      if (detail.status === "waiting") {
        if (task.status === "needs_input") return "waiting"; // already asked the user
        const question = await deps.manus.latestAssistantMessage(task.manus_task_id).catch(() => null);
        await applyManusStop(deps, task.manus_task_id, { stopReason: "ask", message: question, taskUrl: detail.task_url });
        return "needs_input";
      }
      if (detail.status === "error") {
        const reason = await deps.manus.latestError(task.manus_task_id).catch(() => null);
        await failTask(deps, task.id, ["submitted", "needs_input"], `The agent reported an error. ${reason ?? ""}`.trim());
        return "failed";
      }
      return "running";
    }

    default:
      return (await notifyTask(deps, task.id)) ? "notified" : "notify_skipped";
  }
}

export function reconcileHandler(deps: TaskDeps, config: ReconcileConfig) {
  return async (req: Request): Promise<Response> => {
    if (!(await hasBearer(req, config.cronSecret))) return new Response("Unauthorized", { status: 401 });

    const olderThan = new Date(Date.now() - (config.staleAfterMs ?? DEFAULT_STALE_AFTER_MS)).toISOString();
    const tasks = await deps.store.listForReconcile(olderThan);
    const outcomes: Record<string, number> = {};

    for (const task of tasks) {
      let outcome: string;
      try {
        outcome = await reconcileTask(deps, task);
      } catch (err) {
        outcome = "error";
        log.error("reconcile.task_error", { taskId: task.id, error: errorText(err) });
      }
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }

    log.info("reconcile.done", { checked: tasks.length, ...outcomes });
    return Response.json({ checked: tasks.length, outcomes });
  };
}
