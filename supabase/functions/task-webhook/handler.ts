import { wakeTaskWorker } from "../_shared/delegation/wake.ts";
import { admin, checked } from "../_shared/http.ts";
import {
  type ManusClient,
  verifyManusSignature,
} from "../_shared/delegation/manus.ts";
export function webhookHandler(manus: ManusClient, url: string, db = admin()) {
  return async (req: Request) => {
    if (req.method !== "POST") return new Response("Use POST", { status: 405 });
    const raw = await req.text();
    if (raw.length > 500000) return new Response("Too large", { status: 413 });
    const signature = req.headers.get("x-webhook-signature"),
      timestamp = req.headers.get("x-webhook-timestamp");
    // Manus activation probes are acknowledged but cannot mutate state.
    if (!signature || !timestamp) return new Response("Ignored");
    try {
      const verify = async (refresh: boolean) =>
        verifyManusSignature({
          publicKeyPem: await manus.publicKeyPem(refresh),
          url,
          rawBody: raw,
          signatureB64: signature,
          timestamp,
        });
      if (!await verify(false) && !await verify(true)) {
        return new Response("Unauthorized", { status: 401 });
      }
      const event = JSON.parse(raw);
      if (
        typeof event.event_id !== "string" ||
        typeof event.task_detail?.task_id !== "string"
      ) return new Response("Invalid event", { status: 400 });
      const task = checked(
        await db.from("alo_tasks").select("id").eq(
          "manus_task_id",
          event.task_detail.task_id,
        ).maybeSingle(),
      ).data;
      if (task) {
        const saved = await db.from("alo_task_events").insert({
          event_id: event.event_id,
          task_id: task.id,
        });
        if (saved.error && saved.error.code !== "23505") throw saved.error;
        // Wake the leased worker; never execute actions within webhook requests.
        checked(
          await db.from("alo_tasks").update({
            next_run_at: new Date().toISOString(),
          }).eq("id", task.id).eq("status", "running"),
        );
        wakeTaskWorker();
      }
      return new Response("ok");
    } catch {
      return new Response("Webhook processing failed", { status: 500 });
    }
  };
}
