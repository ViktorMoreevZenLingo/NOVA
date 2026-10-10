// Shared contract between the phone assistant (Track A) and the email side.
// Change only by agreement — both sides code against these types.

export type TaskIntent = "summarize_emails" | "research";

/** Built by the backend from the authenticated caller; never from LLM-provided identities. */
export type AgentTaskRequest = {
  intent: TaskIntent;
  instruction: string;
  userId: string;
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

/** Builds Manus instructions (and picks connectors) for an email request of this user. */
export type BuildGmailPrompt = (instruction: string, userId: string) => Promise<ManusTaskInput>;

/**
 * Delivers the result outside the app (History already shows it). Resolves without
 * sending when the user has no delivery channel; throws on failure (retried by reconcile).
 */
export type SendResultEmail = (userId: string, result: TaskResult) => Promise<void>;
