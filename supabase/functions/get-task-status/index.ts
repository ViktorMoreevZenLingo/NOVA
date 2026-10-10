import { createTaskStore } from "../_shared/db.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { getTaskStatusHandler } from "./handler.ts";

Deno.serve(getTaskStatusHandler({ store: createTaskStore() }, {
  vapiSecret: requireEnv("VAPI_TOOL_SECRET"),
  caller: { pin: requireEnv("TEST_USER_PIN"), webCallPhone: optionalEnv("DEMO_WEBCALL_PHONE") },
}));
