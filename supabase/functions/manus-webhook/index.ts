import { buildGmailPrompt } from "../_shared/email/prompt.ts";
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
    sendResultEmail,
  },
  { webhookUrl: requireEnv("MANUS_WEBHOOK_URL") },
));
