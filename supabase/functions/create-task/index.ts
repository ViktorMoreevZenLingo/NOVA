import { buildGmailPrompt } from "../_shared/email/prompt.ts";
import { sendResultEmail } from "../_shared/email/notify.ts";
import { createTaskStore } from "../_shared/db.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { createManusClient } from "../_shared/manus.ts";
import { createTaskHandler } from "./handler.ts";

const handler = createTaskHandler(
  {
    store: createTaskStore(),
    manus: createManusClient(requireEnv("MANUS_API_KEY")),
    buildGmailPrompt,
    sendResultEmail,
  },
  {
    vapiSecret: requireEnv("VAPI_TOOL_SECRET"),
    caller: { pin: requireEnv("TEST_USER_PIN"), webCallPhone: optionalEnv("DEMO_WEBCALL_PHONE") },
  },
);

Deno.serve(handler);
