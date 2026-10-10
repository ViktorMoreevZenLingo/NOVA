// Shared contract between Track A (voice/agent) and Track B (email).
// Change only by agreement — both tracks code against these types.

export type TaskIntent = "summarize_emails" | "research";

/** Built by the backend from the authenticated caller; never from LLM-provided recipients. */
export type AgentTaskRequest = {
  intent: TaskIntent;
  instruction: string;
  notifyEmail: string;
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

/** Track B: builds Manus instructions (and picks connectors) for an email request. */
export type BuildGmailPrompt = (instruction: string) => Promise<ManusTaskInput>;

/** Track B: sends exactly one email. Must throw on failure (Track A handles retries/idempotency). */
export type SendResultEmail = (recipient: string, result: TaskResult) => Promise<void>;
