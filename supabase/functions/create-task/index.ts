import { buildCalendarPrompt } from "../_shared/email/calendar.ts";
import { buildGmailPrompt } from "../_shared/email/prompt.ts";
import { buildReplyPrompt } from "../_shared/email/reply.ts";
import { sendResultEmail } from "../_shared/email/notify.ts";
import { createTaskStore } from "../_shared/db.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { createManusClient } from "../_shared/manus.ts";
import { vapiApiFromEnv } from "../_shared/vapi-api.ts";
import { executeGoogleAction } from "../_shared/email/actions.ts";
import { createTaskHandler } from "./handler.ts";

const handler = createTaskHandler(
  {
    store: createTaskStore(),
    manus: createManusClient(requireEnv("MANUS_API_KEY")),
    buildGmailPrompt,
    buildCalendarPrompt,
    buildReplyPrompt,
    sendResultEmail,
    vapiApi: vapiApiFromEnv(),
    executeAction: executeGoogleAction,
  },
  {
    vapiSecret: requireEnv("VAPI_TOOL_SECRET"),
    caller: { pin: requireEnv("TEST_USER_PIN"), webCallPhone: optionalEnv("DEMO_WEBCALL_PHONE") },
  },
);

Deno.serve(handler);
