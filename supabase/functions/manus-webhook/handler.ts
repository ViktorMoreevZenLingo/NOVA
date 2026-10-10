import { errorText, log } from "../_shared/log.ts";
import { type ManusWebhookEvent, verifyManusSignature } from "../_shared/manus.ts";
import { applyManusStop, type TaskDeps } from "../_shared/tasks.ts";

export type ManusWebhookConfig = {
  /** Exact URL registered with Manus; part of the signed string. */
  webhookUrl: string;
};

const ok = () => new Response("ok", { status: 200 });

export function manusWebhookHandler(deps: TaskDeps, config: ManusWebhookConfig) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const rawBody = await req.text();
    const signature = req.headers.get("x-webhook-signature");
    const timestamp = req.headers.get("x-webhook-timestamp");

    if (!signature || !timestamp) {
      // Manus sends an activation test request when the webhook is registered.
      // Acknowledge it, but never act on unsigned payloads.
      log.info("webhook.unsigned_ignored");
      return ok();
    }
    const verify = async (refresh: boolean) =>
      verifyManusSignature({
        publicKeyPem: await deps.manus.publicKeyPem(refresh),
        url: config.webhookUrl,
        rawBody,
        signatureB64: signature,
        timestamp,
      });
    // Retry once with a fresh key in case Manus rotated it.
    if (!(await verify(false)) && !(await verify(true))) {
      log.warn("webhook.bad_signature");
      return new Response("Unauthorized", { status: 401 });
    }

    let event: ManusWebhookEvent;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const detail = event.task_detail;
    log.info("webhook.received", { eventId: event.event_id, eventType: event.event_type, manusTaskId: detail?.task_id });
    if (event.event_type !== "task_stopped" || !detail?.task_id) return ok();

    const stopReason = detail.stop_reason === "ask" ? "ask" : "finish";
    try {
      await applyManusStop(deps, detail.task_id, {
        stopReason,
        message: detail.message,
        taskUrl: detail.task_url,
        taskTitle: detail.task_title,
        structuredOutput: detail.structured_output,
      });
    } catch (err) {
      // 500 lets Manus retry (if it does); the reconcile sweep is the backstop either way.
      log.error("webhook.processing_failed", { manusTaskId: detail.task_id, error: errorText(err) });
      return new Response("Processing failed", { status: 500 });
    }
    return ok();
  };
}
