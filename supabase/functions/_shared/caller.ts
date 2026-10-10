// Phone mode uses caller metadata from the authenticated Vapi webhook. Model-supplied
// numbers/user IDs cannot choose an account. Legacy PIN mode remains for old deployments.
import { safeEqual } from "./crypto.ts";
import type { Profile, TaskStore } from "./db.ts";
import type { VapiToolRequest } from "./vapi.ts";

export const MAX_PIN_FAILURES = 3;
/** Across all calls for one profile, per hour (stops brute force via many short calls). */
export const MAX_HOURLY_PIN_FAILURES = 10;

export type CallerConfig = {
  /** MVP: one PIN for the demo user. Later: hashed per-profile PIN. */
  pin?: string;
  mode?: "phone" | "pin";
  /** Optional: phone to assume for Vapi dashboard web calls (no caller number). */
  webCallPhone?: string;
};

export type CallerAuth =
  | { ok: true; profile: Profile; method?: "phone" | "pin" }
  | { ok: false; reason: "unknown_caller" | "pin_required" | "pin_incorrect" | "locked" };

export async function authenticateCaller(
  store: TaskStore,
  config: CallerConfig,
  req: VapiToolRequest,
  pin: string | undefined,
): Promise<CallerAuth> {
  if (config.mode === "phone") {
    // Browser-call numbers are client supplied, not telephone caller ID.
    const phone = req.callType === "webCall" ? undefined : req.customerNumber;
    const profile = phone ? await store.findProfileByPhone(phone) : null;
    if (!profile) return { ok: false, reason: "unknown_caller" };
    const session = await store.getCallSession(req.callId);
    if (session?.user_id && session.user_id !== profile.user_id) return { ok: false, reason: "unknown_caller" };
    if (!session?.verified_at) await store.markCallVerified(req.callId, profile.user_id);
    return { ok: true, profile, method: "phone" };
  }
  const session = await store.getCallSession(req.callId);
  if (session && session.pin_failures >= MAX_PIN_FAILURES) return { ok: false, reason: "locked" };
  if (session?.verified_at && session.user_id) {
    const profile = await store.getProfile(session.user_id);
    if (profile) return { ok: true, profile };
  }

  // A web call's "customer number" is client-supplied, never caller ID: ignore it.
  const phone = req.callType === "webCall" ? config.webCallPhone : req.customerNumber;
  const profile = phone ? await store.findProfileByPhone(phone) : null;
  if (!profile) return { ok: false, reason: "unknown_caller" };
  if ((await store.recentPinFailures(profile.user_id)) >= MAX_HOURLY_PIN_FAILURES) return { ok: false, reason: "locked" };

  if (!pin) return { ok: false, reason: "pin_required" };
  if (!config.pin || !(await safeEqual(pin.replace(/\D/g, ""), config.pin))) {
    const failures = await store.recordPinFailure(req.callId, profile.user_id);
    return { ok: false, reason: failures >= MAX_PIN_FAILURES ? "locked" : "pin_incorrect" };
  }

  await store.markCallVerified(req.callId, profile.user_id);
  return { ok: true, profile };
}

/** What the assistant should say/do for each auth failure. */
export const AUTH_ERROR_MESSAGES: Record<Exclude<CallerAuth, { ok: true }>["reason"], string> = {
  unknown_caller:
    "This calling number is not linked to one unambiguous NOVA AI account. Ask the caller to check the number on their existing web profile. Do not ask for a PIN, security answer, or a different number to impersonate.",
  pin_required: "Ask the caller for their 6-digit PIN, then call this tool again with the `pin` argument.",
  pin_incorrect: "The PIN was incorrect. Ask the caller to repeat their PIN.",
  locked: "Too many incorrect PIN attempts. Tell the caller you can't continue on this call.",
};
