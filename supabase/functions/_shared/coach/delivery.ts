// Delivers an approved share. The manager always sees it in NOVA (RLS on coach_shares);
// if the employee set a manager email and has Gmail connected, it is also emailed from
// their own Gmail. The recipient comes from settings, never from the model.
// Lease → send → mark: the approved→sent transition is the lease; a failed send releases it.
import { errorText, log } from "../log.ts";
import type { DeliverShare } from "./service.ts";
import type { CoachStore, Share } from "./store.ts";

export type SendEmail = (userId: string, mail: { to: string; subject: string; body: string }) => Promise<boolean>;

export function createShareDelivery(
  deps: { store: CoachStore; sendEmail?: SendEmail; employeeName?: (userId: string) => Promise<string | null> },
): DeliverShare {
  return async (share: Share) => {
    if (!share.recipient_email || !deps.sendEmail) return "in_app";
    const leased = await deps.store.transitionShare(share.id, ["approved"], { status: "sent", sent_at: new Date().toISOString() });
    if (!leased) return "in_app";
    try {
      const name = (await deps.employeeName?.(share.user_id)) ?? "A member of your team";
      const sent = await deps.sendEmail(share.user_id, {
        to: share.recipient_email,
        subject: `${name} shared a request with you via NOVA`,
        body: [
          `${name} chose to share this with you through NOVA Coach:`,
          "",
          `"${share.text}"`,
          "",
          "Only this text was shared. You can reply in the NOVA app under Team.",
        ].join("\n"),
      });
      if (sent) return "emailed";
    } catch (err) {
      log.error("coach.share_email_failed", { shareId: share.id, error: errorText(err) });
    }
    await deps.store.transitionShare(share.id, ["sent"], { status: "approved", sent_at: null });
    return "in_app";
  };
}
