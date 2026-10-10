import { buildCalendarPrompt } from "../_shared/email/calendar.ts";
import { buildGmailPrompt } from "../_shared/email/prompt.ts";
import { buildReplyPrompt } from "../_shared/email/reply.ts";
import { sendResultEmail } from "../_shared/email/notify.ts";
import { createTaskStore } from "../_shared/db.ts";
import { requireEnv } from "../_shared/env.ts";
import { createManusClient } from "../_shared/manus.ts";
import { manusWebhookHandler } from "./handler.ts";

Deno.serve(manusWebhookHandler(
  {
    store: createTaskStore(),
    manus: createManusClient(requireEnv("MANUS_API_KEY")),
    buildGmailPrompt,
    buildCalendarPrompt,
    buildReplyPrompt,
    sendResultEmail,
  },
  { webhookUrl: requireEnv("MANUS_WEBHOOK_URL") },
));
