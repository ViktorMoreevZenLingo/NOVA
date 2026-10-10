import { taskHandler } from "./handler.ts";
Deno.serve(taskHandler(Deno.env.get("VAPI_TASK_SERVICE_SECRET") ?? ""));
