// Write actions requested by phone (send email, create calendar event). They are
// validated and summarized at request time, and executed only after the user
// approves them in the Alo app (layer L4), with the user's own Google account.
import type { ExecuteGoogleAction } from "../contracts.ts";
import { execute } from "../tools.ts";

export type ActionIntent = "send_email" | "create_calendar_event";

const str = (params: Record<string, unknown>, key: string) => typeof params[key] === "string" ? (params[key] as string).trim() : "";
const isEmail = (v: string) => /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(v);
const hasOffset = (v: string) => /(Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));

/** Picks and validates the action's fields; returns an error message for the caller if invalid. */
export function prepareAction(intent: ActionIntent, args: Record<string, unknown>):
  | { ok: true; params: Record<string, unknown>; summary: string }
  | { ok: false; error: string } {
  if (intent === "send_email") {
    const to = str(args, "to"), subject = str(args, "subject"), body = str(args, "body");
    if (!isEmail(to)) return { ok: false, error: 'Argument "to" must be one valid email address. Ask the caller to spell it.' };
    if (!subject || /[\r\n]/.test(subject) || subject.length > 200) {
      return { ok: false, error: 'Argument "subject" is required (one line).' };
    }
    if (!body || body.length > 5000) return { ok: false, error: 'Argument "body" is required (max 5000 characters).' };
    return { ok: true, params: { to, subject, body }, summary: `To: ${to}\nSubject: ${subject}\n\n${body}` };
  }
  const title = str(args, "title"), start = str(args, "start"), end = str(args, "end");
  const attendees = Array.isArray(args.attendees)
    ? args.attendees.filter((a): a is string => typeof a === "string").map((a) => a.trim())
    : [];
  if (!title || title.length > 200) return { ok: false, error: 'Argument "title" is required.' };
  if (!hasOffset(start) || !hasOffset(end) || Date.parse(end) <= Date.parse(start)) {
    return { ok: false, error: 'Arguments "start" and "end" must be ISO times with a timezone offset, end after start.' };
  }
  if (attendees.some((a) => !isEmail(a))) return { ok: false, error: 'Every "attendees" entry must be an email address.' };
  return {
    ok: true,
    params: { title, start, end, attendees },
    summary: `${title}\n${start} – ${end}${attendees.length ? `\nInvites: ${attendees.join(", ")}` : ""}`,
  };
}

export const executeGoogleAction: ExecuteGoogleAction = (userId, intent, params) =>
  execute(userId, intent, intent === "send_email" ? { to: params.to, subject: params.subject, body: params.body } : params);
