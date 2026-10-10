import { voiceDelegationHandler } from "../_shared/delegation/voice.ts";
import { createTaskStore } from "../_shared/db.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { getTaskStatusHandler } from "./handler.ts";

const legacy = getTaskStatusHandler({ store: createTaskStore() }, {
  vapiSecret: requireEnv("VAPI_TOOL_SECRET"),
  caller: {
    mode: "phone",
  },
});

Deno.serve(voiceDelegationHandler({
  additionalVapiSecret: optionalEnv("VAPI_DELEGATION_SECRET"),
  vapiSecret: requireEnv("VAPI_TOOL_SECRET"),
  taskSecret: requireEnv("VAPI_TASK_SERVICE_SECRET"),
  caller: {
    mode: "phone",
  },
  store: createTaskStore(),
  legacy,
}));
