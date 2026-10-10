import { admin, checked, HttpError } from "../http.ts";
import { accessToken } from "../providers.ts";
import { runTool } from "./providers.ts";
export async function deliverOneEmail(db = admin()) {
  const delivery = checked(
    await db.rpc("alo_delivery_claim", { p_channel: "email" }),
  ).data?.[0];
  if (!delivery) return;
  let sending = false;
  try {
    const task = checked(
      await db.from("alo_tasks").select("result,instruction").eq(
        "id",
        delivery.task_id,
      ).eq("user_id", delivery.user_id).eq("status", "completed").single(),
    ).data;
    if (!task?.result) throw new Error("Missing completed result");
    const token = await accessToken(delivery.user_id, "gmail");
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) {
      throw new HttpError(409, "Reconnect Gmail to receive email results.");
    }
    const { emailAddress } = await response.json();
    if (typeof emailAddress !== "string") throw new Error("Missing recipient");
    sending = true;
    await runTool(delivery.user_id, "send_email", {
      to: emailAddress,
      subject: `NOVA AI: ${task.instruction.slice(0, 100)}`,
      body: task.result.slice(0, 20000),
    });
    checked(
      await db.from("alo_task_deliveries").update({ status: "sent" }).eq(
        "id",
        delivery.id,
      ).eq("lease_id", delivery.lease_id).eq("status", "claimed"),
    );
  } catch {
    checked(
      await db.from("alo_task_deliveries").update({
        status: sending ? "uncertain" : "failed",
        error: sending
          ? "Email may have been delivered. Check Gmail before retrying."
          : "Reconnect Gmail to receive email results. The result remains in History.",
      }).eq("id", delivery.id).eq("lease_id", delivery.lease_id).eq(
        "status",
        "claimed",
      ),
    );
  }
}
