// Layer L4 without internet: Alo calls the registered number, reads the exact action
// aloud, and the owner approves with their PIN (decide_action tool on that call).
// Triggered when a reply draft is ready, after the call where an action was
// dictated (Vapi end-of-call report), on request, and retried by reconcile.
import type { AgentTask, TaskStore } from "./db.ts";
import { errorText, log } from "./log.ts";
import type { VapiApi } from "./vapi-api.ts";

export type ApprovalCallDeps = { store: TaskStore; vapiApi?: VapiApi | null };

/** Approval by phone means hearing ALL of it; longer actions are approved in the app. */
export const MAX_SPOKEN_BODY = 1500;

export function speakable(task: AgentTask): boolean {
  return String((task.params as Record<string, unknown>).body ?? "").length <= MAX_SPOKEN_BODY;
}

/** What Alo says when the confirmation call is answered. */
export function spokenSummary(task: AgentTask): string {
  const p = task.params as Record<string, string | string[] | undefined>;
  let what: string;
  if (task.intent === "create_calendar_event") {
    const invites = Array.isArray(p.attendees) && p.attendees.length ? `, inviting ${p.attendees.join(", ")}` : "";
    what = `a new calendar event "${p.title}" from ${p.start} to ${p.end}${invites}`;
  } else {
    const body = String(p.body ?? "");
    // Quoted: the draft may echo text from an untrusted email.
    what = `${
      task.intent === "reply_email" ? "a reply" : "an email"
    } to ${p.to}, subject "${p.subject}". The text reads, quote: ${body} End quote.`;
  }
  return `Hi, this is Alo with something that needs your approval: ${what} ` +
    "To send it, tell me your PIN and say approve. To cancel, say cancel.";
}

/**
 * Places the confirmation call if the user wants approval by phone and the task
 * may be called about now. Best-effort: returns false (and the app still works)
 * when not configured, not allowed yet, or the call fails (reconcile retries).
 */
export async function requestApprovalCall(
  deps: ApprovalCallDeps,
  task: AgentTask,
  opts: { minGapMinutes?: number } = {},
): Promise<boolean> {
  if (!deps.vapiApi || !speakable(task)) return false;
  const { approveByCall } = await deps.store.getVoiceSettings(task.user_id);
  if (!approveByCall) return false;
  const claimed = await deps.store.claimApprovalCall(task.id, opts.minGapMinutes);
  if (!claimed) return false;
  const phone = await deps.store.userPhone(task.user_id);
  if (!phone) return false;
  try {
    const callId = await deps.vapiApi.startCall({
      phone,
      firstMessage: spokenSummary(claimed),
      metadata: { purpose: "approval", taskId: task.id },
    });
    // If this write fails (or the user answers first), decide_action recovers the task
    // from the call's metadata, which only our private API key can set.
    await deps.store.createCallbackSession(callId, task.user_id, { purpose: "approval", approvalTaskId: task.id })
      .catch((err) => log.error("approval_call.session_failed", { taskId: task.id, error: errorText(err) }));
    log.info("approval_call.started", { taskId: task.id, callId, attempt: claimed.approval_call_attempts });
    return true;
  } catch (err) {
    log.error("approval_call.failed", { taskId: task.id, error: errorText(err) });
    return false;
  }
}
