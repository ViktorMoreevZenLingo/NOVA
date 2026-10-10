import { voiceDelegationHandler } from "../_shared/delegation/voice.ts";
import { createTaskStore } from "../_shared/db.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { getTaskStatusHandler } from "./handler.ts";

const legacy = getTaskStatusHandler({ store: createTaskStore() }, {
  vapiSecret: requireEnv("VAPI_TOOL_SECRET"),
  caller: {
    pin: requireEnv("TEST_USER_PIN"),
    webCallPhone: optionalEnv("DEMO_WEBCALL_PHONE"),
  },
});

Deno.serve(voiceDelegationHandler({
  additionalVapiSecret: optionalEnv("VAPI_DELEGATION_SECRET"),
  vapiSecret: requireEnv("VAPI_TOOL_SECRET"),
  taskSecret: requireEnv("VAPI_TASK_SERVICE_SECRET"),
  caller: {
    pin: requireEnv("TEST_USER_PIN"),
    webCallPhone: optionalEnv("DEMO_WEBCALL_PHONE"),
  },
  store: createTaskStore(),
  legacy,
}));
