// Outbound calls (follow-ups and pulse check-ins) via the Vapi REST API.
// Restored from the archived callback prototype (branch archive/callback-approval).
// Docs: https://docs.vapi.ai/api-reference/calls/create
import { errorText, log } from "../log.ts";
import { followupFirstMessage, PULSE_FIRST_MESSAGE } from "./prompts.ts";
import type { CoachProfile, CoachStore, Invite, Step } from "./store.ts";

export type OutboundCall = { assistant: "coach" | "pulse"; phone: string; firstMessage: string; metadata: Record<string, string> };
export type Dialer = (call: OutboundCall) => Promise<string>;

export type VapiDialerConfig = { apiKey: string; phoneNumberId: string; coachAssistantId: string; pulseAssistantId: string };

export function createVapiDialer(config: VapiDialerConfig, fetchFn: typeof fetch = fetch): Dialer {
  return async ({ assistant, phone, firstMessage, metadata }) => {
    const res = await fetchFn("https://api.vapi.ai/call", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        assistantId: assistant === "coach" ? config.coachAssistantId : config.pulseAssistantId,
        phoneNumberId: config.phoneNumberId,
        customer: { number: phone },
        name: assistant === "coach" ? "NOVA Coach follow-up" : "NOVA pulse check-in",
        assistantOverrides: { firstMessage, metadata },
        metadata,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || typeof json?.id !== "string") throw new Error(`Vapi call.create failed: HTTP ${res.status}`);
    return json.id;
  };
}

/** Null when outbound calling isn't configured; the worker then leaves work scheduled. */
export function vapiDialerFromEnv(): Dialer | null {
  const apiKey = Deno.env.get("VAPI_API_KEY");
  const phoneNumberId = Deno.env.get("VAPI_PHONE_NUMBER_ID");
  const coachAssistantId = Deno.env.get("VAPI_COACH_ASSISTANT_ID");
  const pulseAssistantId = Deno.env.get("VAPI_PULSE_ASSISTANT_ID");
  return apiKey && phoneNumberId && coachAssistantId && pulseAssistantId
    ? createVapiDialer({ apiKey, phoneNumberId, coachAssistantId, pulseAssistantId })
    : null;
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local weekday and minutes since midnight in the employee's timezone. */
function localClock(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return { day: WEEKDAY[get("weekday")] ?? 0, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

export function inCallWindow(profile: Pick<CoachProfile, "call_days" | "call_from" | "call_to" | "timezone">, at: Date): boolean {
  let clock;
  try {
    clock = localClock(at, profile.timezone);
  } catch {
    clock = localClock(at, "Europe/Sofia");
  }
  return profile.call_days.includes(clock.day) && clock.minutes >= toMinutes(profile.call_from) &&
    clock.minutes < toMinutes(profile.call_to);
}

/** The next moment (15-minute steps, up to 8 days ahead) inside the call window. */
export function nextCallWindow(profile: Pick<CoachProfile, "call_days" | "call_from" | "call_to" | "timezone">, from: Date): Date {
  const start = new Date(Math.ceil(from.getTime() / 900_000) * 900_000);
  for (let i = 0; i < 8 * 96; i++) {
    const at = new Date(start.getTime() + i * 900_000);
    if (inCallWindow(profile, at)) return at;
  }
  return new Date(from.getTime() + 86_400_000);
}

const RETRY_MS = 30 * 60_000;
const MAX_ATTEMPTS = 2;

export type WorkerDeps = {
  store: CoachStore;
  dial: Dialer | null;
  now?: () => Date;
  employeeName?: (userId: string) => Promise<string | null>;
};

export type WorkerReport = { followups: number; invites: number; deferred: number; failed: number; skipped: number };

/**
 * One worker pass: places due follow-up and survey calls. Anything outside the
 * employee's call window, or with calls switched off, is moved/skipped, never forced.
 */
export async function runCoachWorker(
  deps: WorkerDeps,
  opts: { limit?: number; ignoreWindow?: boolean; followupsFor?: string } = {},
): Promise<WorkerReport> {
  const now = deps.now ?? (() => new Date());
  const report: WorkerReport = { followups: 0, invites: 0, deferred: 0, failed: 0, skipped: 0 };
  if (!deps.dial) return report;
  const limit = opts.limit ?? 10;

  for (const step of await deps.store.claimFollowups(limit, opts.followupsFor)) {
    await placeFollowup(deps, step, now(), report, opts.ignoreWindow ?? false);
  }
  // A targeted run (the demo "a week passed" button) only handles that user's follow-ups.
  if (opts.followupsFor) return report;
  for (const invite of await deps.store.claimInvites(limit)) {
    await placeInvite(deps, invite, now(), report, opts.ignoreWindow ?? false);
  }
  return report;
}

async function placeFollowup(deps: WorkerDeps, step: Step, at: Date, report: WorkerReport, ignoreWindow: boolean) {
  const profile = await deps.store.profile(step.user_id);
  if (!profile.followups_enabled) {
    await deps.store.finishFollowup(step.id, { followup_status: "cancelled" });
    report.skipped++;
    return;
  }
  if (!ignoreWindow && !inCallWindow(profile, at)) {
    await deps.store.finishFollowup(step.id, {
      followup_status: "scheduled",
      followup_at: nextCallWindow(profile, at).toISOString(),
      followup_attempts: Math.max(0, step.followup_attempts - 1),
    });
    report.deferred++;
    return;
  }
  const phone = await deps.store.phoneForUser(step.user_id);
  if (!phone) {
    await deps.store.finishFollowup(step.id, { followup_status: "failed" });
    report.failed++;
    return;
  }
  try {
    const name = (await deps.employeeName?.(step.user_id)) ?? null;
    const callId = await deps.dial!({
      assistant: "coach",
      phone,
      firstMessage: followupFirstMessage(name?.split(/\s+/)[0] ?? null, step.text),
      metadata: { kind: "coach_followup", step_id: step.id },
    });
    await deps.store.finishFollowup(step.id, { followup_status: "called", followup_call_id: callId });
    log.info("coach.followup_called", { stepId: step.id });
    report.followups++;
  } catch (err) {
    const retry = step.followup_attempts < MAX_ATTEMPTS;
    await deps.store.finishFollowup(
      step.id,
      retry
        ? { followup_status: "scheduled", followup_at: new Date(at.getTime() + RETRY_MS).toISOString() }
        : { followup_status: "failed" },
    );
    log.warn("coach.followup_failed", { stepId: step.id, retry, error: errorText(err) });
    report.failed++;
  }
}

async function placeInvite(deps: WorkerDeps, invite: Invite, at: Date, report: WorkerReport, ignoreWindow: boolean) {
  const profile = await deps.store.profile(invite.user_id);
  if (!profile.surveys_enabled) {
    await deps.store.finishInvite(invite.campaign_id, invite.user_id, { status: "declined" });
    report.skipped++;
    return;
  }
  if (!ignoreWindow && !inCallWindow(profile, at)) {
    await deps.store.finishInvite(invite.campaign_id, invite.user_id, {
      status: "pending",
      attempts: Math.max(0, invite.attempts - 1),
      next_attempt_at: nextCallWindow(profile, at).toISOString(),
    });
    report.deferred++;
    return;
  }
  const phone = await deps.store.phoneForUser(invite.user_id);
  if (!phone) {
    await deps.store.finishInvite(invite.campaign_id, invite.user_id, { status: "failed" });
    report.failed++;
    return;
  }
  try {
    const callId = await deps.dial!({
      assistant: "pulse",
      phone,
      firstMessage: PULSE_FIRST_MESSAGE,
      metadata: { kind: "survey", campaign_id: invite.campaign_id },
    });
    await deps.store.finishInvite(invite.campaign_id, invite.user_id, { status: "called", call_id: callId });
    report.invites++;
  } catch (err) {
    const retry = invite.attempts < MAX_ATTEMPTS;
    await deps.store.finishInvite(
      invite.campaign_id,
      invite.user_id,
      retry ? { status: "pending", next_attempt_at: new Date(at.getTime() + RETRY_MS).toISOString() } : { status: "failed" },
    );
    log.warn("survey.call_failed", { campaignId: invite.campaign_id, retry, error: errorText(err) });
    report.failed++;
  }
}
