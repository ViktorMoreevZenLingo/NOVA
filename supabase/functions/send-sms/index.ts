import { createHandler } from "./handler.ts";

Deno.serve(createHandler({
  hookSecret: Deno.env.get("SEND_SMS_HOOK_SECRET") ?? "",
  apiKey: Deno.env.get("ZADARMA_API_KEY") ?? "",
  apiSecret: Deno.env.get("ZADARMA_API_SECRET") ?? "",
}));
