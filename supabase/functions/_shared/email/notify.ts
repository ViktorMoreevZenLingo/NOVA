// STUB — owned by Track B (feat/gmail-integration), which replaces this file
// with a real Resend implementation. Contract: SendResultEmail in ../contracts.ts.
import type { SendResultEmail } from "../contracts.ts";
import { log } from "../log.ts";

export const sendResultEmail: SendResultEmail = (_recipient, result) => {
  log.info("email.mock_sent", { taskId: result.taskId, status: result.status, mock: true });
  return Promise.resolve();
};
