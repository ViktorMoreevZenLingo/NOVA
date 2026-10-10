// Applies the security policy to an authenticated voice request: decides the
// required layers (policy.ts) and runs L3, the user's verification question, on
// this call. L1 + L2 are already done by authenticateCaller; L4 (approval) is
// handled by the caller of this function for write intents.
import type { CallerAuth } from "./caller.ts";
import type { TaskIntent } from "./contracts.ts";
import type { TaskStore } from "./db.ts";
import { log } from "./log.ts";
import { assessRisk, type Layer, requiredLayers, type RiskAssessment } from "./policy.ts";
import type { VapiToolRequest } from "./vapi.ts";

export const MAX_QUESTION_FAILURES = 3;

export type AccessDecision =
  | { ok: true; assessment: RiskAssessment; required: Layer[]; satisfied: Layer[] }
  | { ok: false; assessment: RiskAssessment; message: string };

type Authed = Extract<CallerAuth, { ok: true }>;

export async function checkAccess(
  deps: { store: TaskStore },
  req: VapiToolRequest,
  auth: Authed,
  intent: TaskIntent | "status",
  params: Record<string, unknown> = {},
  verificationAnswer?: string,
): Promise<AccessDecision> {
  // Checking a task's status reveals as much as reading it: treat as medium.
  const assessment = intent === "status" ? { risk: "medium" as const, reason: "reveals task status" } : assessRisk(intent, params);
  if (auth.method === "phone") {
    return {
      ok: true,
      assessment,
      required: assessment.risk === "high" ? ["caller_id", "approval"] : ["caller_id"],
      satisfied: ["caller_id"],
    };
  }
  const settings = await deps.store.getVoiceSettings(auth.profile.user_id);
  const required = requiredLayers(assessment.risk, settings.securityLevel);
  const satisfied: Layer[] = ["caller_id", "pin"];
  if (!required.includes("verification")) return { ok: true, assessment, required, satisfied };

  const why = settings.securityLevel === "secure" ? "the account is in Secure mode" : `this request ${assessment.reason}`;
  const say = (text: string): AccessDecision => ({ ok: false, assessment, message: `Security check (${why}): ${text}` });

  const session = await deps.store.getCallSession(req.callId);
  if (session?.question_verified_at) return { ok: true, assessment, required, satisfied: [...satisfied, "verification"] };
  if ((session?.question_failures ?? 0) >= MAX_QUESTION_FAILURES) {
    return say("too many wrong answers to the verification question. Tell the caller you can't do this on this call.");
  }
  if (!settings.verificationQuestion) {
    return say("the caller has not set a verification question. Tell them to set one in the Alo app (Security) first.");
  }
  if (!verificationAnswer) {
    return say(
      `ask the caller their verification question exactly: "${settings.verificationQuestion}" ` +
        "Then call this tool again with the same arguments plus verification_answer. Never hint at or repeat the answer.",
    );
  }
  if (!(await deps.store.checkVerification(auth.profile.user_id, verificationAnswer))) {
    const failures = await deps.store.recordQuestionFailure(req.callId);
    log.warn("access.verification_failed", { callId: req.callId, failures });
    return say(
      failures >= MAX_QUESTION_FAILURES
        ? "the answer was wrong too many times. Tell the caller you can't do this on this call."
        : "that answer was not correct. Ask the question once more.",
    );
  }
  await deps.store.markQuestionVerified(req.callId);
  log.info("access.verification_passed", { callId: req.callId, risk: assessment.risk });
  return { ok: true, assessment, required, satisfied: [...satisfied, "verification"] };
}
