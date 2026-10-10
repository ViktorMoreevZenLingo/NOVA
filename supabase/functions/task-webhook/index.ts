import { env } from "../_shared/http.ts";
import { createManusClient } from "../_shared/delegation/manus.ts";
import { webhookHandler } from "./handler.ts";
Deno.serve(
  webhookHandler(
    createManusClient(env("MANUS_API_KEY")),
    env("TASK_WEBHOOK_URL"),
  ),
);
