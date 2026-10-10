// Vapi server messages for the Alo assistant (assistant.server.url). We use the
// end-of-call report: when a call that left an action waiting for approval ends,
// Alo calls the registered number back to read it and confirm (L4 by phone).
import { requestApprovalCall } from "../_shared/approval-call.ts";
import { hasBearer } from "../_shared/crypto.ts";
import type { TaskStore } from "../_shared/db.ts";
import { errorText, log } from "../_shared/log.ts";
import type { VapiApi } from "../_shared/vapi-api.ts";

export type VapiEventsDeps = { store: TaskStore; vapiApi: VapiApi | null };

export function vapiEventsHandler(deps: VapiEventsDeps, config: { vapiSecret: string }) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!(await hasBearer(req, config.vapiSecret))) return new Response("Unauthorized", { status: 401 });
    const body = await req.json().catch(() => null);
    const message = body?.message;
    if (message?.type !== "end-of-call-report" || typeof message.call?.id !== "string") return Response.json({ ok: true });

    try {
      for (const task of await deps.store.awaitingApprovalForCall(message.call.id)) {
        await requestApprovalCall(deps, task, { minGapMinutes: 0 });
      }
    } catch (err) {
      // Reconcile retries confirmation calls; never make Vapi retry the report.
      log.error("vapi_events.failed", { callId: message.call.id, error: errorText(err) });
    }
    return Response.json({ ok: true });
  };
}
