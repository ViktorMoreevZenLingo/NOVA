import { createTaskStore } from "../_shared/db.ts";
import { requireEnv } from "../_shared/env.ts";
import { vapiApiFromEnv } from "../_shared/vapi-api.ts";
import { vapiEventsHandler } from "./handler.ts";

Deno.serve(vapiEventsHandler({ store: createTaskStore(), vapiApi: vapiApiFromEnv() }, { vapiSecret: requireEnv("VAPI_TOOL_SECRET") }));
