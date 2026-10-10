// Regression tests for the code-review findings (lease, needs_input reconcile,
// orphan adoption, re-ask, hourly PIN lockout, key rotation).
import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createTaskHandler } from "../../supabase/functions/create-task/handler.ts";
import { manusWebhookHandler } from "../../supabase/functions/manus-webhook/handler.ts";
import { reconcileHandler } from "../../supabase/functions/reconcile/handler.ts";
import { createAndSubmitTask } from "../../supabase/functions/_shared/tasks.ts";
import { NonRetryableTaskError } from "../../supabase/functions/_shared/contracts.ts";
import { makeDeps, makeSigner, PIN, USER_ID, VAPI_SECRET, vapiRequest } from "./fakes.ts";

const WEBHOOK_URL = "https://example.supabase.co/functions/v1/manus-webhook";
const newTask = (toolCallId = crypto.randomUUID()) => ({
  user_id: USER_ID,
  vapi_call_id: "call-1",
  vapi_tool_call_id: toolCallId,
  intent: "research" as const,
  prompt: "Find hackathon tips",
});

async function setup() {
  const ctx = makeDeps();
  const signer = await makeSigner();
  ctx.manus.pem = signer.pem;
  const webhook = manusWebhookHandler(ctx.deps, { webhookUrl: WEBHOOK_URL });
  const reconcile = reconcileHandler(ctx.deps, { cronSecret: "c" });
  const runReconcile = () => reconcile(new Request("http://x", { method: "POST", headers: { authorization: "Bearer c" } }));
  async function send(detail: Record<string, unknown>) {
    const body = JSON.stringify({ event_id: "e", event_type: "task_stopped", task_detail: detail });
    const ts = Math.floor(Date.now() / 1000);
    const sig = await signer.sign(WEBHOOK_URL, body, ts);
    return webhook(
      new Request("http://x", { method: "POST", headers: { "x-webhook-signature": sig, "x-webhook-timestamp": String(ts) }, body }),
    );
  }
  return { ...ctx, send, runReconcile, signer };
}

Deno.test("lease: sender crash after claim is retried once the lease expires", async () => {
  const { deps, store, email, runReconcile } = await setup();
  const { task } = await createAndSubmitTask(deps, newTask());
  await store.transition(task.id, ["submitted"], { status: "completed", result: "r" });
  // Simulate a crash: claimed, never sent, never released.
  await store.claimNotification(task.id);
  await runReconcile();
  assertEquals(email.sent.length, 0, "fresh lease must block a second sender");

  store.tasks[0].notify_claimed_at = new Date(Date.now() - 11 * 60_000).toISOString();
  await runReconcile();
  assertEquals(email.sent.length, 1);
  assertEquals(store.only().notify_claimed_at, null);
  assertEquals(typeof store.only().notified_at, "string");
});

Deno.test("lease: a stale release cannot reopen a newer claim", async () => {
  const { deps, store } = await setup();
  const { task } = await createAndSubmitTask(deps, newTask());
  await store.transition(task.id, ["submitted"], { status: "completed", result: "r" });
  const first = (await store.claimNotification(task.id))!;
  store.tasks[0].notify_claimed_at = new Date(Date.now() - 11 * 60_000).toISOString(); // lease expired
  const second = (await store.claimNotification(task.id))!;
  await store.releaseNotification(task.id, first.notify_claimed_at!); // late failure from the first sender
  assertEquals(store.only().notify_claimed_at, second.notify_claimed_at);
  assertEquals(store.only().notify_attempts, 0);
});

Deno.test("reconcile: needs_input task finished in the Manus UI gets completed + emailed", async () => {
  const { deps, store, manus, email, send, runReconcile } = await setup();
  await createAndSubmitTask(deps, newTask());
  await send({ task_id: "manus-1", message: "Which inbox?", stop_reason: "ask" });
  assertEquals(store.only().status, "needs_input");

  manus.detail = { ...manus.detail, status: "waiting" };
  await runReconcile();
  assertEquals(store.only().status, "needs_input");
  assertEquals(email.sent.length, 1, "no repeated question email");

  manus.detail = { ...manus.detail, status: "stopped" };
  await runReconcile();
  assertEquals(store.only().status, "completed");
  assertEquals(email.sent.length, 2);
  assertEquals(email.sent[1].result.status, "completed");
});

Deno.test("webhook: a second question while needs_input is delivered too", async () => {
  const { deps, store, email, send } = await setup();
  await createAndSubmitTask(deps, newTask());
  await send({ task_id: "manus-1", message: "Q1", stop_reason: "ask" });
  await send({ task_id: "manus-1", message: "Q2", stop_reason: "ask" });
  assertEquals(store.only().result, "Q2");
  assertEquals(email.sent.map((e) => e.result.summary), ["Q1", "Q2"]);
});

Deno.test("orphan: Manus task created despite a client timeout is adopted, not duplicated", async () => {
  const { deps, store, manus, email, send } = await setup();
  manus.failCreate = true; // our side saw a failure...
  const { task } = await createAndSubmitTask(deps, newTask());
  assertEquals(task.status, "submit_failed");

  // ...but Manus did run it and reports back with our tag in the title.
  await send({ task_id: "manus-orphan", task_title: `Research: x #nova:${task.id}`, message: "done", stop_reason: "finish" });
  const row = store.only();
  assertEquals(row.manus_task_id, "manus-orphan");
  assertEquals(row.status, "completed");
  assertEquals(email.sent.length, 1);
});

Deno.test("orphan: a duplicate Manus run for an already-submitted row is ignored", async () => {
  const { deps, store, email, send } = await setup();
  const { task } = await createAndSubmitTask(deps, newTask());
  await send({ task_id: "manus-dupe", task_title: `Research: x #nova:${task.id}`, message: "done", stop_reason: "finish" });
  assertEquals(store.only().manus_task_id, "manus-1");
  assertEquals(store.only().status, "submitted");
  assertEquals(email.sent.length, 0);
});

Deno.test("submit: Manus title carries the row tag", async () => {
  const { deps, manus } = await setup();
  const { task } = await createAndSubmitTask(deps, newTask());
  assertMatch(manus.created[0].title, new RegExp(`#nova:${task.id}$`));
});

Deno.test("pin: lockout across many calls for the same profile (hourly)", async () => {
  const { deps, store } = await setup();
  const handler = createTaskHandler(deps, { vapiSecret: VAPI_SECRET, caller: { pin: PIN } });
  const args = { intent: "research", instruction: "x" };
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 2; j++) {
      await handler(vapiRequest([{ id: `tc-${i}-${j}`, name: "create_task", args: { ...args, pin: "000000" } }], { callId: `call-${i}` }));
    }
  }
  const res = await handler(vapiRequest([{ id: "tc-ok", name: "create_task", args: { ...args, pin: PIN } }], { callId: "call-new" }));
  assertMatch((await res.json()).results[0].error, /Too many/);
  assertEquals(store.tasks.length, 0);
});

Deno.test("submit: non-retryable error (Gmail not connected) fails at once and tells the caller", async () => {
  const { deps, store, manus, email } = await setup();
  deps.buildGmailPrompt = () => Promise.reject(new NonRetryableTaskError("Gmail is not connected."));
  const handler = createTaskHandler(deps, { vapiSecret: VAPI_SECRET, caller: { pin: PIN } });
  const res = await handler(
    vapiRequest([{ id: "tc", name: "create_task", args: { intent: "summarize_emails", instruction: "x", pin: PIN } }]),
  );
  assertMatch((await res.json()).results[0].error, /Gmail is not connected/);
  assertEquals(store.only().status, "failed");
  assertEquals(manus.created.length, 0);
  assertEquals(email.sent.length, 1);
  assertEquals(email.sent[0].result.status, "failed");
});

Deno.test("webhook: rotated signing key is refetched once", async () => {
  const { deps, store, manus, send } = await setup();
  await createAndSubmitTask(deps, newTask());
  manus.stalePem = (await makeSigner()).pem; // cache holds an old key
  const res = await send({ task_id: "manus-1", message: "done", stop_reason: "finish" });
  assertEquals(res.status, 200);
  assertEquals(manus.keyFetches, 1);
  assertEquals(store.only().status, "completed");
});
