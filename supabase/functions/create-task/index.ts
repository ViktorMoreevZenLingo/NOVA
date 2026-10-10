import { voiceDelegationHandler } from "../_shared/delegation/voice.ts";
import { buildCalendarPrompt } from "../_shared/email/calendar.ts";
import { buildGmailPrompt } from "../_shared/email/prompt.ts";
import { buildReplyPrompt } from "../_shared/email/reply.ts";
import { sendResultEmail } from "../_shared/email/notify.ts";
import { createTaskStore } from "../_shared/db.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { createManusClient } from "../_shared/manus.ts";
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
    executeAction: executeGoogleAction,
  },
  {
    vapiSecret: requireEnv("VAPI_TOOL_SECRET"),
    caller: {
      mode: "phone",
    },
  },
);

Deno.serve(voiceDelegationHandler({
  additionalVapiSecret: optionalEnv("VAPI_DELEGATION_SECRET"),
  vapiSecret: requireEnv("VAPI_TOOL_SECRET"),
  taskSecret: requireEnv("VAPI_TASK_SERVICE_SECRET"),
  caller: {
    mode: "phone",
  },
  store: createTaskStore(),
  legacy: handler,
}));
