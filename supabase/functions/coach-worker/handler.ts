// Cron entry point (pg_cron, every minute; see supabase/scripts/enable_coach_worker.sql):
// places due coach follow-up calls and pulse check-in calls inside each employee's call window.
import { hasBearer } from "../_shared/crypto.ts";
import { errorText, log } from "../_shared/log.ts";
import { runCoachWorker, type WorkerDeps } from "../_shared/coach/outbound.ts";

export function coachWorkerHandler(deps: WorkerDeps, config: { cronSecret: string }) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!(await hasBearer(req, config.cronSecret))) return new Response("Unauthorized", { status: 401 });
    if (!deps.dial) return Response.json({ skipped: "outbound calls not configured" });
    try {
      const report = await runCoachWorker(deps);
      if (report.followups || report.invites || report.failed) log.info("coach.worker", report);
      return Response.json(report);
    } catch (err) {
      log.error("coach.worker_failed", { error: errorText(err) });
      return Response.json({ error: "worker failed" }, { status: 500 });
    }
  };
}
