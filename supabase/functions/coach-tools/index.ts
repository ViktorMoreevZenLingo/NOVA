import { createTaskStore } from "../_shared/db.ts";
import { optionalEnv, requireEnv } from "../_shared/env.ts";
import { coachDeps } from "../_shared/coach/wiring.ts";
import { coachTools } from "../_shared/coach/service.ts";
import { coachToolsHandler } from "./handler.ts";

Deno.serve(coachToolsHandler(
  { taskStore: createTaskStore(), tools: coachTools(coachDeps()) },
  { vapiSecret: requireEnv("VAPI_TOOL_SECRET"), additionalVapiSecret: optionalEnv("VAPI_DELEGATION_SECRET") },
));
