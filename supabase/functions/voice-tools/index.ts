import { voiceDelegationHandler } from "../_shared/delegation/voice.ts";
import { createDirectVoice } from "../_shared/delegation/direct-voice.ts";
import { createTaskStore } from "../_shared/db.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";

// No Manus client or credential is initialized on this request path.
Deno.serve(voiceDelegationHandler({
  vapiSecret: requireEnv("VAPI_TOOL_SECRET"),
  additionalVapiSecret: optionalEnv("VAPI_DELEGATION_SECRET"),
  taskSecret: requireEnv("VAPI_TASK_SERVICE_SECRET"),
  caller: { mode: "phone" },
  store: createTaskStore(),
  direct: createDirectVoice(),
  legacy: async (request) => {
    // Old task readbacks retain their original handler; direct reads never reach it.
    return await fetch(
      `${requireEnv("SUPABASE_URL")}/functions/v1/create-task`,
      {
        method: "POST",
        headers: request.headers,
        body: await request.text(),
        signal: AbortSignal.timeout(25000),
      },
    );
  },
}));
