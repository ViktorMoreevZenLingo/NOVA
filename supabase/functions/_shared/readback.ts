// L4 by voice: before approving, Alo reads the exact action back to the caller on
// the call. Approval by phone means hearing ALL of it, so longer texts are approved
// in the Alo app instead.
import type { AgentTask } from "./db.ts";

export const MAX_SPOKEN_BODY = 1500;

export function speakable(task: AgentTask): boolean {
  return String((task.params as Record<string, unknown>).body ?? "").length <= MAX_SPOKEN_BODY;
}

/** The exact words the assistant must read before asking for approval. */
export function readBack(task: AgentTask): string {
  const p = task.params as Record<string, string | string[] | undefined>;
  if (task.intent === "create_calendar_event") {
    const invites = Array.isArray(p.attendees) && p.attendees.length ? `, inviting ${p.attendees.join(", ")}` : "";
    return `A new calendar event "${p.title}" from ${p.start} to ${p.end}${invites}.`;
  }
  // Quoted: a reply draft may echo text from an untrusted email.
  return `${task.intent === "reply_email" ? "A reply" : "An email"} to ${p.to}, subject "${p.subject}". ` +
    `The text reads, quote: ${String(p.body ?? "")} End quote.`;
}
