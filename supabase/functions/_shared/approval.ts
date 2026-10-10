// Layer L4: the owner decides on an action waiting for approval. Shared by the
// confirmation call (decide_action tool) and the app (voice-approve function), so
// both channels follow exactly the same rules:
//   * only the owner, only while awaiting_approval (conditional update → no double send)
//   * what runs is re-validated (with the optional edited email text)
//   * approval is consumed BEFORE the provider call (status 'sending'), and a provider
//     failure is never retried automatically: an action can't run twice.
import type { ExecuteGoogleAction } from "./contracts.ts";
import type { AgentTask, TaskStore } from "./db.ts";
import { prepareAction } from "./email/actions.ts";
import { errorText, log } from "./log.ts";
import { MAX_SPOKEN_BODY } from "./approval-call.ts";

/** Well inside reconcile's 3-minute "stuck sending" window. */
const EXECUTE_TIMEOUT_MS = 45_000;

export type ApprovalDeps = { store: TaskStore; executeAction: ExecuteGoogleAction };

export class ApprovalError extends Error {
  constructor(readonly code: "not_found" | "conflict" | "invalid" | "failed", message: string) {
    super(message);
  }
}

const EMAIL_INTENTS = new Set(["send_email", "reply_email"]);
const NOT_WAITING = "This task is no longer waiting for approval.";

export async function decideTask(
  deps: ApprovalDeps,
  input: { taskId: string; userId: string; approve: boolean; via: "call" | "app"; editedBody?: string },
): Promise<{ status: "completed" | "rejected" }> {
  const task = await deps.store.getTask(input.taskId);
  if (!task || task.user_id !== input.userId) throw new ApprovalError("not_found", "Task not found.");
  if (task.status !== "awaiting_approval") throw new ApprovalError("conflict", NOT_WAITING);
  const now = () => new Date().toISOString();

  if (!input.approve) {
    const rejected = await deps.store.transition(task.id, ["awaiting_approval"], {
      status: "rejected",
      approved_via: input.via,
      completed_at: now(),
      notified_at: now(), // the user just decided; no email about it
    });
    if (!rejected) throw new ApprovalError("conflict", NOT_WAITING);
    log.info("approval.rejected", { taskId: task.id, via: input.via });
    return { status: "rejected" };
  }

  const kind = task.intent === "create_calendar_event" ? "create_calendar_event" : "send_email";
  const edit = input.editedBody !== undefined && EMAIL_INTENTS.has(task.intent) ? { body: input.editedBody } : {};
  const action = prepareAction(kind, { ...task.params, ...edit });
  if (!action.ok) throw new ApprovalError("invalid", action.error);
  if (input.via === "call" && String(action.params.body ?? "").length > MAX_SPOKEN_BODY) {
    throw new ApprovalError("invalid", "This one is too long to approve by phone. Approve it in the Alo app.");
  }

  const claimed = await deps.store.transition(task.id, ["awaiting_approval"], {
    status: "sending",
    approved_at: now(),
    approved_via: input.via,
    params: { ...task.params, ...action.params },
    result: action.summary,
    layers: withLayer(task, "approval"),
  });
  if (!claimed) throw new ApprovalError("conflict", NOT_WAITING);

  try {
    await Promise.race([
      deps.executeAction(input.userId, kind, action.params),
      new Promise((_, reject) => setTimeout(() => reject(new Error("provider timeout")), EXECUTE_TIMEOUT_MS)),
    ]);
  } catch (err) {
    log.error("approval.execute_failed", { taskId: task.id, error: errorText(err) });
    await deps.store.transition(task.id, ["sending"], {
      status: "failed",
      error_message: "Could not confirm the result. Check Gmail/Calendar before trying again.",
      completed_at: now(),
      notified_at: now(),
    });
    throw new ApprovalError("failed", "Could not confirm the result. Check Gmail/Calendar before trying again.");
  }
  // Also from 'failed': if reconcile gave up on a slow send that did go out, tell the truth.
  await deps.store.transition(task.id, ["sending", "failed"], {
    status: "completed",
    error_message: null,
    result: `${kind === "send_email" ? "Sent" : "Created"}.\n\n${action.summary}`,
    completed_at: now(),
    notified_at: now(),
  });
  log.info("approval.executed", { taskId: task.id, intent: task.intent, via: input.via });
  return { status: "completed" };
}

function withLayer(task: AgentTask, layer: string): AgentTask["layers"] {
  return [...task.layers.filter((l) => l !== layer), layer] as AgentTask["layers"];
}
