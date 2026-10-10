import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { manusWebhookHandler } from "../../supabase/functions/manus-webhook/handler.ts";
import { createAndSubmitTask } from "../../supabase/functions/_shared/tasks.ts";
import { makeDeps, makeSigner, USER_ID } from "./fakes.ts";

const WEBHOOK_URL = "https://example.supabase.co/functions/v1/manus-webhook";

async function setup() {
  const ctx = makeDeps();
  const signer = await makeSigner();
  ctx.manus.pem = signer.pem;
  const handler = manusWebhookHandler(ctx.deps, { webhookUrl: WEBHOOK_URL });
  const { task } = await createAndSubmitTask(ctx.deps, {
    user_id: USER_ID,
    vapi_call_id: "call-1",
    vapi_tool_call_id: "tc-1",
    intent: "research",
    prompt: "Find hackathon tips",
  });

  async function send(payload: unknown, opts: { tamper?: boolean; ts?: number } = {}) {
    const body = JSON.stringify(payload);
    const ts = opts.ts ?? Math.floor(Date.now() / 1000);
    const sig = await signer.sign(WEBHOOK_URL, body, ts);
    return handler(
      new Request("http://internal/manus-webhook", {
        method: "POST",
        headers: { "x-webhook-signature": sig, "x-webhook-timestamp": String(ts) },
        body: opts.tamper ? body.replace("finish", "ask") : body,
      }),
    );
  }

  return { ...ctx, handler, task, send };
}

const stopped = (stop_reason: "finish" | "ask", message = "Here is the summary") => ({
  event_id: "task_stopped_manus-1",
  event_type: "task_stopped",
  task_detail: { task_id: "manus-1", task_title: "t", task_url: "https://manus.im/app/manus-1", message, stop_reason },
});

Deno.test("webhook: finish completes the task and sends one email", async () => {
  const { send, store, email } = await setup();
  assertEquals((await send(stopped("finish"))).status, 200);
  const task = store.only();
  assertEquals(task.status, "completed");
  assertEquals(task.result, "Here is the summary");
  assertEquals(email.sent.length, 1);
  assertEquals(email.sent[0].userId, USER_ID);
  assertEquals(email.sent[0].result.status, "completed");
});

Deno.test("webhook: duplicate delivery is idempotent (single email)", async () => {
  const { send, email } = await setup();
  await send(stopped("finish"));
  assertEquals((await send(stopped("finish"))).status, 200);
  assertEquals(email.sent.length, 1);
});

Deno.test("webhook: ask -> needs_input email, then finish -> completed email", async () => {
  const { send, store, email } = await setup();
  await send(stopped("ask", "Which mailbox?"));
  assertEquals(store.only().status, "needs_input");
  assertEquals(email.sent[0].result.status, "needs_input");
  assertEquals(email.sent[0].result.summary, "Which mailbox?");

  await send(stopped("finish"));
  assertEquals(store.only().status, "completed");
  assertEquals(email.sent.length, 2);
  assertEquals(email.sent[1].result.status, "completed");
});

Deno.test("webhook: empty message falls back to latest assistant message", async () => {
  const { send, store } = await setup();
  await send(stopped("finish", ""));
  assertEquals(store.only().result, "Final answer from Manus");
});

Deno.test("webhook: background jobs still running keeps task submitted", async () => {
  const { send, store, manus, email } = await setup();
  manus.detail = { ...manus.detail, status: "stopped", has_running_background_jobs: true };
  await send(stopped("finish"));
  assertEquals(store.only().status, "submitted");
  assertEquals(email.sent.length, 0);
});

Deno.test("webhook: bad or stale signature is rejected and changes nothing", async () => {
  const { send, store, email } = await setup();
  assertEquals((await send(stopped("finish"), { tamper: true })).status, 401);
  assertEquals((await send(stopped("finish"), { ts: Math.floor(Date.now() / 1000) - 600 })).status, 401);
  assertEquals(store.only().status, "submitted");
  assertEquals(email.sent.length, 0);
});

Deno.test("webhook: unsigned request (registration test) gets 200 but is ignored", async () => {
  const { handler, store } = await setup();
  const res = await handler(new Request("http://internal/manus-webhook", { method: "POST", body: JSON.stringify(stopped("finish")) }));
  assertEquals(res.status, 200);
  assertEquals(store.only().status, "submitted");
});

Deno.test("webhook: unknown task and task_created events are acknowledged", async () => {
  const { send, store } = await setup();
  const unknown = stopped("finish");
  unknown.task_detail.task_id = "manus-404";
  assertEquals((await send(unknown)).status, 200);
  assertEquals((await send({ event_id: "x", event_type: "task_created", task_detail: { task_id: "manus-1" } })).status, 200);
  assertEquals(store.only().status, "submitted");
});

Deno.test("webhook: email failure releases the claim for a later retry", async () => {
  const { send, store, email } = await setup();
  email.fail = true;
  await send(stopped("finish"));
  const task = store.only();
  assertEquals(task.status, "completed");
  assertEquals(task.notified_at, null);
  assertEquals(task.notify_attempts, 1);
  assertMatch(task.result!, /summary/);
});
