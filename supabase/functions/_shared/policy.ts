// Security levels and access layers for voice requests.
//
// Every request is assessed for risk; the risk decides which verification layers
// are required. The user's own setting (standard / secure) is a floor on top.
//
// All layers work within the phone call itself (no internet, no outbound calls):
//
//   L1 caller_id     the call comes from the account's SMS-verified phone
//   L2 pin           the caller said the PIN on this call
//   L3 verification  the caller answered their personal verification question on this call
//   L4 approval      the owner approved this exact action after Alo read it back on the
//                    call (or in a logged-in Alo app session)
import type { TaskIntent } from "./contracts.ts";

export type RiskLevel = "low" | "medium" | "high";
export type SecurityLevel = "standard" | "secure";
export type Layer = "caller_id" | "pin" | "verification" | "approval";

export const LAYER_ORDER: Layer[] = ["caller_id", "pin", "verification", "approval"];

export type RiskAssessment = { risk: RiskLevel; reason: string };

/** Actions stored right away as awaiting approval (L4), no AI step. */
export const WRITE_INTENTS = new Set<TaskIntent>(["send_email", "create_calendar_event"]);

export function assessRisk(intent: TaskIntent, params: Record<string, unknown> = {}): RiskAssessment {
  switch (intent) {
    case "research":
      return { risk: "low", reason: "no personal data is read" };
    case "summarize_emails":
    case "calendar":
      return { risk: "medium", reason: "reads the user's personal data" };
    case "reply_email":
      return { risk: "high", reason: "reads an email and sends a reply on the user's behalf" };
    case "send_email":
      return { risk: "high", reason: "sends an email on the user's behalf" };
    case "create_calendar_event": {
      const invites = Array.isArray(params.attendees) && params.attendees.length > 0;
      return { risk: "high", reason: invites ? "creates an event and invites other people" : "changes the user's calendar" };
    }
  }
}

/**
 * low/medium: L1 + L2. high (sends or changes something): + L3 + L4, so nothing leaves
 * the account without a second secret and the owner's approval of the exact action.
 * Secure mode: + L3 on every call.
 */
export function requiredLayers(risk: RiskLevel, level: SecurityLevel): Layer[] {
  const layers = new Set<Layer>(["caller_id", "pin"]);
  if (risk === "high" || level === "secure") layers.add("verification");
  if (risk === "high") layers.add("approval");
  return LAYER_ORDER.filter((l) => layers.has(l));
}
