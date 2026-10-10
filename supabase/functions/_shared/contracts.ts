// Shared contract between the phone assistant (Track A) and the email side.
// Change only by agreement — both sides code against these types.

/** Read intents go to Manus; write intents run only after approval in the Alo app. */
export type TaskIntent =
  | "research"
  | "summarize_emails"
  | "calendar"
  // AI reads the email, drafts a reply (Manus), user approves in the app, then it's sent.
  | "reply_email"
  | "send_email"
  | "create_calendar_event";

/** Built by the backend from the authenticated caller; never from LLM-provided identities. */
export type AgentTaskRequest = {
  intent: TaskIntent;
  instruction: string;
  userId: string;
  /** Intent-specific parameters, e.g. { email_query: "from:ivan newer_than:7d" }. */
  params?: Record<string, unknown>;
  /** Alo profile (name + notes), untrusted user-written context. */
  userContext?: { name: string | null; notes: string | null };
};

/** What gets sent to Manus task.create. */
export type ManusTaskInput = {
  content: string;
  connectors: string[];
};

export type TaskResult = {
  taskId: string;
  status: "completed" | "needs_input" | "failed";
  summary: string;
  taskUrl?: string;
};

/** Thrown when a task can never succeed as requested (e.g. Gmail not connected); no retries. */
export class NonRetryableTaskError extends Error {}

/** Builds Manus instructions for an email request, from this user's own Gmail only. */
export type BuildGmailPrompt = (instruction: string, userId: string, params?: Record<string, unknown>) => Promise<ManusTaskInput>;

/**
 * For a reply: the email being answered (from the user's own Gmail) plus the
 * prompt asking Manus for a draft. The recipient and subject are taken from the
 * email itself, never from the model.
 */
export type ReplyDraftInput = ManusTaskInput & {
  structuredOutputSchema: Record<string, unknown>;
  replyTo: { to: string; subject: string; originalFrom: string; originalSubject: string };
};
export type BuildReplyPrompt = (instruction: string, userId: string, params?: Record<string, unknown>) => Promise<ReplyDraftInput>;

/** Same for a calendar request (this user's own Google Calendar). */
export type BuildCalendarPrompt = (instruction: string, userId: string, params?: Record<string, unknown>) => Promise<ManusTaskInput>;

/** Runs an approved write action with the user's own Google account (reply_email is sent as send_email). */
export type ExecuteGoogleAction = (
  userId: string,
  intent: "send_email" | "create_calendar_event",
  params: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Delivers the result outside the app (History already shows it). Resolves without
 * sending when the user has no delivery channel; throws on failure (retried by reconcile).
 */
export type SendResultEmail = (userId: string, result: TaskResult) => Promise<void>;
