import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { reconcileHandler } from "../../supabase/functions/reconcile/handler.ts";
import { createAndSubmitTask } from "../../supabase/functions/_shared/tasks.ts";
import { makeDeps, USER_ID } from "./fakes.ts";

const CRON_SECRET = "cron-secret";

function setup() {
  const ctx = makeDeps();
  const handler = reconcileHandler(ctx.deps, { cronSecret: CRON_SECRET });
  const run = () =>
    handler(new Request("http://internal/reconcile", { method: "POST", headers: { authorization: `Bearer ${CRON_SECRET}` } }));
  const create = () =>
    createAndSubmitTask(ctx.deps, {
      user_id: USER_ID,
      vapi_call_id: "call-1",
      vapi_tool_call_id: crypto.randomUUID(),
      intent: "research",
      prompt: "Find hackathon tips",
    });
  return { ...ctx, run, create, handler };
}

Deno.test("reconcile: requires the cron secret", async () => {
  const { handler } = setup();
  assertEquals((await handler(new Request("http://internal/reconcile", { method: "POST" }))).status, 401);
});

Deno.test("reconcile: missed webhook - stopped task gets completed and emailed", async () => {
  const { run, create, store, manus, email } = setup();
  await create();
  manus.detail = { ...manus.detail, status: "stopped" };
  await run();
  assertEquals(store.only().status, "completed");
  assertEquals(store.only().result, "Final answer from Manus");
  assertEquals(email.sent.length, 1);
});

Deno.test("reconcile: running task is left alone", async () => {
  const { run, create, store, email } = setup();
  await create();
  const res = await run();
  assertEquals((await res.json()).outcomes, { running: 1 });
  assertEquals(store.only().status, "submitted");
  assertEquals(email.sent.length, 0);
});

Deno.test("reconcile: waiting task becomes needs_input; error task becomes failed", async () => {
  const a = setup();
  await a.create();
  a.manus.detail = { ...a.manus.detail, status: "waiting" };
  a.manus.assistantMessage = "Need confirmation";
  await a.run();
  assertEquals(a.store.only().status, "needs_input");
  assertEquals(a.email.sent[0].result.summary, "Need confirmation");

  const b = setup();
  await b.create();
  b.manus.detail = { ...b.manus.detail, status: "error" };
  b.manus.errorMessage = "Out of credits";
  await b.run();
  assertEquals(b.store.only().status, "failed");
  assertMatch(b.email.sent[0].result.summary, /Out of credits/);
});

Deno.test("reconcile: failed submission is retried, then fails after 3 attempts", async () => {
  const { run, create, store, manus, email } = setup();
  manus.failCreate = true;
  await create(); // attempt 1
  await run(); // attempt 2
  assertEquals(store.only().status, "submit_failed");
  await run(); // attempt 3 -> gives up
  assertEquals(store.only().status, "failed");
  assertEquals(email.sent.length, 1);
  assertEquals(email.sent[0].result.status, "failed");
});

Deno.test("reconcile: failed submission recovers when Manus comes back", async () => {
  const { run, create, store, manus } = setup();
  manus.failCreate = true;
  await create();
  manus.failCreate = false;
  await run();
  assertEquals(store.only().status, "submitted");
  assertEquals(store.only().error_message, null);
});

Deno.test("reconcile: unsent notifications are retried until delivered", async () => {
  const { run, create, store, manus, email } = setup();
  await create();
  manus.detail = { ...manus.detail, status: "stopped" };
  email.fail = true;
  await run();
  assertEquals(store.only().notify_attempts, 1);
  email.fail = false;
  await run();
  assertEquals(email.sent.length, 1);
  await run();
  assertEquals(email.sent.length, 1);
});
