import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createTaskHandler } from "../supabase/functions/create-task/handler.ts";
import { makeDeps, PIN, USER_EMAIL, USER_PHONE, VAPI_SECRET, vapiRequest } from "./fakes.ts";

function setup(opts: { webCallPhone?: string } = {}) {
  const ctx = makeDeps();
  const handler = createTaskHandler(ctx.deps, { vapiSecret: VAPI_SECRET, caller: { pin: PIN, ...opts } });
  return { ...ctx, handler };
}

const call = (args: Record<string, unknown>, id = "tc-1") => ({ id, name: "create_task", args });
const validArgs = { intent: "summarize_emails", instruction: "Summarize important emails", pin: PIN };

async function results(res: Response) {
  assertEquals(res.status, 200);
  return (await res.json()).results as { toolCallId: string; result?: string; error?: string }[];
}

Deno.test("create-task: rejects missing/wrong bearer secret", async () => {
  const { handler, store } = setup();
  const res = await handler(vapiRequest([call(validArgs)], { secret: "wrong" }));
  assertEquals(res.status, 401);
  assertEquals(store.tasks.length, 0);
});

Deno.test("create-task: happy path creates and submits a Manus task", async () => {
  const { handler, store, manus } = setup();
  const [r] = await results(await handler(vapiRequest([call(validArgs)])));
  assertEquals(r.toolCallId, "tc-1");
  assertMatch(r.result!, /Task accepted/);

  const task = store.only();
  assertEquals(task.status, "submitted");
  assertEquals(task.manus_task_id, "manus-1");
  assertEquals(task.user_email, USER_EMAIL);
  assertEquals(manus.created[0].connectors, ["gmail-connector"]);
  assertEquals(manus.created[0].content, "GMAIL: Summarize important emails");
});

Deno.test("create-task: research intent uses no connectors and guardrails", async () => {
  const { handler, manus } = setup();
  await handler(vapiRequest([call({ ...validArgs, intent: "research", instruction: "Find hackathon tips" })]));
  assertEquals(manus.created[0].connectors, []);
  assertMatch(manus.created[0].content, /Do not send emails/);
  assertMatch(manus.created[0].content, /Find hackathon tips/);
});

Deno.test("create-task: arguments as JSON string are accepted", async () => {
  const { handler, store } = setup();
  await handler(vapiRequest([{ id: "tc-1", name: "create_task", args: JSON.stringify(validArgs) as unknown as Record<string, unknown> }]));
  assertEquals(store.only().status, "submitted");
});

Deno.test("create-task: validates intent and instruction", async () => {
  const { handler, store } = setup();
  const [a] = await results(await handler(vapiRequest([call({ ...validArgs, intent: "hack" })])));
  assertMatch(a.error!, /intent/);
  const [b] = await results(await handler(vapiRequest([call({ ...validArgs, instruction: "" })])));
  assertMatch(b.error!, /instruction/);
  assertEquals(store.tasks.length, 0);
});

Deno.test("create-task: unknown caller number is refused", async () => {
  const { handler, store } = setup();
  const [r] = await results(await handler(vapiRequest([call(validArgs)], { number: "+15559999999" })));
  assertMatch(r.error!, /not registered/);
  assertEquals(store.tasks.length, 0);
});

Deno.test("create-task: PIN required, then wrong PIN, then lockout after 3 failures", async () => {
  const { handler, store } = setup();
  const [a] = await results(await handler(vapiRequest([call({ ...validArgs, pin: undefined })])));
  assertMatch(a.error!, /PIN/);

  for (let i = 0; i < 2; i++) {
    const [r] = await results(await handler(vapiRequest([call({ ...validArgs, pin: "000000" })])));
    assertMatch(r.error!, /incorrect/);
  }
  const [locked] = await results(await handler(vapiRequest([call({ ...validArgs, pin: "000000" })])));
  assertMatch(locked.error!, /Too many/);
  // Even the right PIN no longer works on this call.
  const [after] = await results(await handler(vapiRequest([call(validArgs, "tc-2")])));
  assertMatch(after.error!, /Too many/);
  assertEquals(store.tasks.length, 0);
});

Deno.test("create-task: once verified, later tool calls in the same call skip the PIN", async () => {
  const { handler, store } = setup();
  await handler(vapiRequest([call(validArgs)]));
  const [r] = await results(await handler(vapiRequest([call({ ...validArgs, pin: undefined }, "tc-2")])));
  assertMatch(r.result!, /Task accepted/);
  assertEquals(store.tasks.length, 2);
});

Deno.test("create-task: retried tool call does not create a duplicate task", async () => {
  const { handler, store, manus } = setup();
  await handler(vapiRequest([call(validArgs)]));
  const [r] = await results(await handler(vapiRequest([call(validArgs)])));
  assertMatch(r.result!, /Task accepted/);
  assertEquals(store.tasks.length, 1);
  assertEquals(manus.created.length, 1);
});

Deno.test("create-task: Manus failure keeps the task as submit_failed", async () => {
  const { handler, store, manus } = setup();
  manus.failCreate = true;
  const [r] = await results(await handler(vapiRequest([call(validArgs)])));
  assertMatch(r.result!, /retry automatically/);
  const task = store.only();
  assertEquals(task.status, "submit_failed");
  assertEquals(task.submit_attempts, 1);
});

Deno.test("create-task: web calls map to DEMO_WEBCALL_PHONE only when configured", async () => {
  const off = setup();
  const [a] = await results(await off.handler(vapiRequest([call(validArgs)], { number: null, callType: "webCall" })));
  assert(a.error);

  const on = setup({ webCallPhone: USER_PHONE });
  const [b] = await results(await on.handler(vapiRequest([call(validArgs)], { number: null, callType: "webCall" })));
  assertMatch(b.result!, /Task accepted/);
});
