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
    if (body.action === "inspect_task" && typeof body.task_id === "string") {
      const inspected = await store.get(body.task_id);
      if (!inspected?.manus_task_id) {
        return Response.json({ error: "No Manus task" }, { status: 404 });
      }
      const events = await manus.events(inspected.manus_task_id);
      return Response.json({
        status: (await manus.getTask(inspected.manus_task_id)).status,
        events: events.filter((e) =>
          ["structured_output_result", "error_message", "assistant_message"]
            .includes(e.type)
        ).slice(0, 5),
      });
    }
    let processed = 0;
    const deadline = Date.now() + 20000;
    while (processed < 8 && Date.now() < deadline) {
      const task = await store.claim();
      if (!task) break;
      await processTask(task, { store, manus, runTool });
      processed++;
    }
    await deliverOneEmail();
    return Response.json({ processed });
  } catch {
    return Response.json({
      error: "Worker unavailable; leased work will be recovered.",
    }, { status: 503 });
  }
});
