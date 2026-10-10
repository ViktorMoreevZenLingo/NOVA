// Delivers a finished phone task outside the app: an email from the user's own
// Gmail to that same address. The Alo app's History already shows every task
// (agent_tasks is mirrored into public.activity), so without Gmail this is a no-op.
//
// This is a system notification to the account owner only, never to a third
// party and never chosen by the LLM, so it doesn't go through the chat agent's
// per-send approval flow.
import type { SendResultEmail, TaskResult } from "../contracts.ts";
import { log } from "../log.ts";
import { execute } from "../tools.ts";
import { hasGmail, ownGmailAddress } from "./gmail.ts";

const SUBJECTS: Record<TaskResult["status"], string> = {
  completed: "Alo: your task is done",
  needs_input: "Alo: your task needs more information",
  failed: "Alo: your task could not be completed",
};

export const sendResultEmail: SendResultEmail = async (userId, result) => {
  if (!(await hasGmail(userId))) {
    log.info("email.skipped_no_gmail", { taskId: result.taskId });
    return;
  }
  const to = await ownGmailAddress(userId);
  const body = [
    result.summary,
    result.taskUrl ? `\nFull details: ${result.taskUrl}` : "",
    "\n—\nSent by Alo from your own Gmail to yourself. You can also find this in the app's History.",
  ].join("\n");
  await execute(userId, "send_email", { to, subject: SUBJECTS[result.status], body });
  log.info("email.sent", { taskId: result.taskId, status: result.status });
};
