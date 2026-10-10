import {
  admin,
  authenticate,
  cors,
  failure,
  HttpError,
  json,
} from "../_shared/http.ts";
import { execute, serviceFor, writeTools } from "../_shared/tools.ts";

// Executes a READ tool for the live (Realtime) session. Write tools are
// refused here — they require explicit confirmation in the text chat.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
    const { user } = await authenticate(req);
    const { name, args } = await req.json();
    if (typeof name !== "string" || writeTools.has(name)) {
      throw new HttpError(403, "That action isn't available by voice.");
    }
    const service = serviceFor[name];
    if (!service) throw new HttpError(400, "Unknown tool");

    const conn = (
      await admin().from("connections").select("service").eq("user_id", user.id)
        .eq("service", service).maybeSingle()
    ).data;
    if (!conn) return json({ result: `${service} is not connected.` });

    let result: unknown;
    try {
      result = await execute(user.id, name, args && typeof args === "object" ? args : {});
    } catch {
      result = `Could not read ${service} right now.`;
    }
    const text = typeof result === "string" ? result : JSON.stringify(result);
    return json({ result: text.slice(0, 30000) });
  } catch (err) {
    return failure(err);
  }
});
