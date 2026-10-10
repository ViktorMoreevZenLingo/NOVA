import {
  admin,
  authenticate,
  checked,
  cors,
  failure,
  HttpError,
  json,
} from "../_shared/http.ts";
import { hasBearer, sha256Hex } from "../_shared/delegation/crypto.ts";
import {
  canonical,
  object,
  text,
  validateSubmission,
} from "../_shared/delegation/validation.ts";
import type { Task } from "../_shared/delegation/contracts.ts";

export function publicTask(t: Task) {
  return {
    id: t.id,
    instruction: t.instruction,
    status: t.status,
    start_mode: t.start_mode,
    run_at: t.run_at,
    timezone: t.timezone,
    pending: t.pending,
    result: t.result,
    revision: t.revision,
    call_id: t.call_id,
    created_at: t.created_at,
  };
}
export function taskHandler(
  serviceSecret: string,
  db = admin(),
  auth = authenticate,
) {
  return async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: cors() });
    }
    try {
      if (req.method !== "POST") throw new HttpError(405, "Use POST.");
      const raw = await req.text();
      if (raw.length > 60000) throw new HttpError(413, "Request too large.");
      const body = object(JSON.parse(raw));
      const action = text(body.action, 40);
      const internal = !!serviceSecret && await hasBearer(req, serviceSecret);
      const rpc = async (name: string, args: Record<string, unknown>) => {
        const r = await db.rpc(name, args);
        if (r.error) {
          throw new HttpError(
            409,
            "Task changed or the request conflicts with existing data. Refresh and try again.",
          );
        }
        return r.data;
      };
      if (["claim_delivery", "ack_delivery"].includes(action)) {
        if (!internal) {
          throw new HttpError(403, "Service authentication required.");
        }
        if (action === "claim_delivery") {
          if (!["callback", "sms"].includes(String(body.channel))) {
            throw new HttpError(400, "Choose callback or sms.");
          }
          const row =
            (await rpc("alo_delivery_claim", { p_channel: body.channel }))?.[0];
          if (!row) return json({ delivery: null });
          return json({
            delivery: {
              id: row.id,
              task_id: row.task_id,
              user_id: row.user_id,
              channel: row.channel,
              lease_id: row.lease_id,
              requires_recipient_auth: true,
              message:
                "Your Alo task is complete. Open Alo to view the result.",
            },
          });
        }
        if (!["sent", "failed", "uncertain"].includes(String(body.status))) {
          throw new HttpError(400, "Invalid delivery status.");
        }
        const row = checked(
          await db.from("alo_task_deliveries").update({
            status: body.status,
            error: body.status === "sent"
              ? null
              : "Delivery was not confirmed.",
          })
            .eq("id", text(body.delivery_id, 36)).eq(
              "lease_id",
              text(body.lease_id, 36),
            ).eq("status", "claimed").gt(
              "lease_until",
              new Date().toISOString(),
            ).select("id").maybeSingle(),
        ).data;
        if (!row) {
          throw new HttpError(
            409,
            "Delivery claim expired or was already acknowledged.",
          );
        }
        return json({ acknowledged: true });
      }
      let userId: string;
      if (internal) {
        const call = checked(
          await db.from("call_sessions").select("user_id,verified_at").eq(
            "vapi_call_id",
            text(body.call_id, 160),
          ).maybeSingle(),
        ).data;
        if (
          !call?.user_id || !call.verified_at ||
          Date.parse(call.verified_at) < Date.now() - 86400000
        ) {
          throw new HttpError(
            403,
            "A recently verified call session is required.",
          );
        }
        userId = call.user_id;
      } else userId = (await auth(req)).user.id;
      if (action === "end_call") {
        if (!internal) {
          throw new HttpError(403, "Only the voice backend can end a call.");
        }
        return json({
          released: await rpc("alo_call_ended", {
            p_user: userId,
            p_call: text(body.call_id, 160),
          }),
        });
      }
      if (action === "submit") {
        if (!internal && body.call_id) {
          throw new HttpError(
            403,
            "The browser cannot submit for a voice call.",
          );
        }
        const existing = checked(
          await db.from("alo_tasks").select("id").eq("user_id", userId).eq(
            "request_id",
            text(body.request_id, 160),
          ).maybeSingle(),
        ).data;
        const data = validateSubmission(body, existing ? 0 : Date.now());
        const hash = await sha256Hex(canonical(data));
        const task = await rpc("alo_task_submit", {
          p_user: userId,
          p_data: { ...data, request_hash: hash },
        });
        return json({
          task: publicTask(task),
          acknowledgement: task.status === "scheduled"
            ? "scheduled"
            : task.status === "running"
            ? "running"
            : "saved",
        }, 202);
      }
      if (!["get", "respond", "approve", "cancel"].includes(action)) {
        throw new HttpError(400, "Unknown task operation.");
      }
      const taskId = text(body.task_id, 36);
      const task = checked(
        await db.from("alo_tasks").select("*").eq("id", taskId).eq(
          "user_id",
          userId,
        ).maybeSingle(),
      ).data;
      if (!task) throw new HttpError(404, "Task not found.");
      if (action === "get") {
        const deliveries = checked(
          await db.from("alo_task_deliveries").select("channel,status,error")
            .eq("task_id", taskId).eq("user_id", userId),
        ).data;
        return json({
          task: { ...publicTask(task), error: task.error, deliveries },
        });
      }
      if (action !== "cancel" && !Number.isInteger(body.revision)) {
        throw new HttpError(400, "Task revision is required.");
      }
      const data = action === "respond"
        ? { answer: text(body.answer, 4000) }
        : {};
      const updated = await rpc("alo_task_command", {
        p_user: userId,
        p_id: taskId,
        p_revision: body.revision ?? 0,
        p_command: action,
        p_data: data,
      });
      return json({ task: publicTask(updated) });
    } catch (err) {
      return failure(err);
    }
  };
}
