// Applies the security policy to an authenticated voice request: decides the
// required layers (policy.ts) and, when L3 is missing, starts the one callback
// allowed for this inbound call. L1 + L2 are already done by authenticateCaller;
// L4 (approval) is handled by the caller of this function for write intents.
import type { CallerAuth } from "./caller.ts";
import type { TaskIntent } from "./contracts.ts";
import type { TaskStore } from "./db.ts";
import { errorText, log } from "./log.ts";
import { assessRisk, type Layer, requiredLayers, type RiskAssessment } from "./policy.ts";
import type { VapiToolRequest } from "./vapi.ts";
import type { VapiApi } from "./vapi-api.ts";

export type AccessDecision =
  | { ok: true; assessment: RiskAssessment; required: Layer[]; satisfied: Layer[] }
  | { ok: false; assessment: RiskAssessment; message: string };

type Authed = Extract<CallerAuth, { ok: true }>;

export async function checkAccess(
  deps: { store: TaskStore; vapiApi: VapiApi | null },
  req: VapiToolRequest,
  auth: Authed,
  intent: TaskIntent | "status",
  params: Record<string, unknown> = {},
): Promise<AccessDecision> {
  // Checking a task's status reveals as much as reading it: treat as medium.
  const assessment = intent === "status" ? { risk: "medium" as const, reason: "reveals task status" } : assessRisk(intent, params);
  const { securityLevel: level } = await deps.store.getVoiceSettings(auth.profile.user_id);
  const required = requiredLayers(assessment.risk, level);
  const satisfied: Layer[] = [
    "caller_id",
    ...(auth.pinNow ? ["pin" as const] : []),
    ...(auth.viaCallback ? ["callback" as const] : []),
  ];

  if (!required.includes("callback") || auth.viaCallback) return { ok: true, assessment, required, satisfied };

  const why = level === "secure" ? "the account is in Secure mode" : `this request ${assessment.reason}`;
  log.info("access.callback_required", { callId: req.callId, risk: assessment.risk, level });
  return { ok: false, assessment, message: await startCallback(deps, req, auth, why) };
}

async function startCallback(
  deps: { store: TaskStore; vapiApi: VapiApi | null },
  req: VapiToolRequest,
  auth: Authed,
  why: string,
): Promise<string> {
  const say = (text: string) => `Security check (${why}): ${text}`;
  if (!deps.vapiApi) return say("callbacks are not configured. Tell the caller this can't be done by phone right now.");

  if (!(await deps.store.claimCallback(req.callId))) {
    return say("a callback to the caller's registered number was already started. Tell them to answer it, then end this call.");
  }
  const phone = await deps.store.userPhone(auth.profile.user_id);
  if (!phone) {
    await deps.store.setCallback(req.callId, null);
    return say("the account has no verified phone. Tell the caller to verify their number in the Alo app.");
  }
  try {
    const outboundCallId = await deps.vapiApi.startCall({
      phone,
      firstMessage: "Hi, this is Alo calling you back on your registered number for a secure session. What would you like me to do?",
      metadata: { purpose: "secure_callback", inboundCallId: req.callId },
    });
    await deps.store.createCallbackSession(outboundCallId, auth.profile.user_id, { purpose: "secure_callback" });
    await deps.store.setCallback(req.callId, outboundCallId);
    log.info("access.callback_started", { callId: req.callId, outboundCallId });
    return say(
      "tell the caller you will call them back right away on their registered number to continue securely, " +
        "that they should repeat the request on that call, then end this call.",
    );
  } catch (err) {
    await deps.store.setCallback(req.callId, null);
    log.error("access.callback_failed", { callId: req.callId, error: errorText(err) });
    return say("the callback could not be started. Apologize and ask the caller to try again in a minute.");
  }
}
