import { env } from "../_shared/http.ts";
import { hasBearer } from "../_shared/delegation/crypto.ts";
import { createManusClient } from "../_shared/delegation/manus.ts";
import { createStore } from "../_shared/delegation/store.ts";
import { runTool } from "../_shared/delegation/providers.ts";
import { processTask } from "../_shared/delegation/worker.ts";
import { deliverOneEmail } from "../_shared/delegation/delivery.ts";
Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });
  if (!await hasBearer(req, env("TASK_WORKER_SECRET"))) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "register_webhook") {
      const url = env("TASK_WEBHOOK_URL");
      const call = async (path: string, data?: unknown) => {
        const response = await fetch(`https://api.manus.ai/v2/${path}`, {
          method: data ? "POST" : "GET",
          headers: {
            "x-manus-api-key": env("MANUS_API_KEY"),
            "Content-Type": "application/json",
          },
          body: data ? JSON.stringify(data) : undefined,
          signal: AbortSignal.timeout(15000),
        });
        const result = await response.json();
        if (!response.ok || !result.ok) {
          throw new Error("Webhook registration failed");
        }
        return result;
      };
      const listed = await call("webhook.list");
      const existing = (listed.data ?? []).find((w: { url: string }) =>
        w.url === url
      );
      const webhook = existing ??
        (await call("webhook.create", { url })).webhook;
      return Response.json({
        webhook: { id: webhook.id, status: webhook.status, url },
      });
    }
    const store = createStore();
    const manus = createManusClient(env("MANUS_API_KEY"));
    const task = await store.claim();
    if (task) await processTask(task, { store, manus, runTool });
    await deliverOneEmail();
    return Response.json({ processed: task ? 1 : 0 });
  } catch {
    return Response.json({
      error: "Worker unavailable; leased work will be recovered.",
    }, { status: 503 });
  }
});
