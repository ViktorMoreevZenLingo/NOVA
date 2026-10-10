import { assert, assertEquals } from "jsr:@std/assert@1.0.19";
import { voiceDelegationHandler } from "../../functions/_shared/delegation/voice.ts";
import {
  FakeStore,
  PIN,
  USER_ID,
  USER_PHONE,
  VAPI_SECRET,
} from "../../../NOVA_VOICE/tests/fakes.ts";
Deno.env.set("APP_URL", "http://localhost:3000");
Deno.test("Vapi bridge: authentication retained, tasks persisted without waiting for Manus, end-call releases once", async () => {
  const store = new FakeStore();
  const tasks: any[] = [];
  let releases = 0;
  const db = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => {
          filters[k] = v;
          return b;
        },
        limit: () => b,
        order: () => b,
        maybeSingle: async () => ({
          error: null,
          data: table === "call_sessions"
            ? await store.getCallSession(String(filters.vapi_call_id))
            : tasks.find((t) =>
              Object.entries(filters).every(([k, v]) => t[k] === v)
            ) ?? null,
        }),
        then: (r: (v: unknown) => void) =>
          r({
            error: null,
            data: tasks.filter((t) =>
              Object.entries(filters).every(([k, v]) => t[k] === v)
            ),
          }),
      };
      return b;
    },
    rpc: async (name: string, args: any) => {
      if (name === "alo_call_ended") {
        const pending = tasks.filter((t) =>
          t.call_id === args.p_call && t.status === "waiting_call"
        );
        pending.forEach((t) => t.status = "queued");
        releases += pending.length;
        return { error: null, data: pending.length };
      }
      if (name === "alo_task_submit") {
        let t = tasks.find((t) => t.request_id === args.p_data.request_id);
        if (!t) {
          t = {
            ...args.p_data,
            user_id: args.p_user,
            id: crypto.randomUUID(),
            status: args.p_data.start_mode === "after_call"
              ? "waiting_call"
              : args.p_data.start_mode === "scheduled"
              ? "scheduled"
              : "queued",
            revision: 0,
          };
          tasks.push(t);
        }
        return { error: null, data: t };
      }
      throw new Error(name);
    },
  };
  const handler = voiceDelegationHandler({
    vapiSecret: VAPI_SECRET,
    taskSecret: "task-secret",
    caller: { pin: PIN },
    store,
    legacy: async () => new Response("legacy"),
  }, db as never);
  const request = (
    args: Record<string, unknown>,
    secret = VAPI_SECRET,
    name = "create_task",
  ) =>
    new Request("https://test/create-task", {
      method: "POST",
      headers: { "x-vapi-secret": secret },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id: "call-1", customer: { number: USER_PHONE } },
          toolCallList: [{
            id: "tool-1",
            function: { name, arguments: args },
          }],
        },
      }),
    });
  const args = {
    intent: "research",
    instruction: "Find a park",
    start_mode: "after_call",
    user_id: "attacker",
    grants: [{ tool: "send_email" }],
  };
  assertEquals((await handler(request(args, "wrong"))).status, 401);
  const missing = await (await handler(request(args))).json();
  assert(missing.results[0].error.includes("PIN"));
  assertEquals(tasks.length, 0);
  const saved = await (await handler(request({ ...args, pin: PIN }))).json();
  assert(saved.results[0].result.includes("saved"));
  assertEquals(tasks.length, 1);
  assertEquals(tasks[0].user_id, USER_ID);
  assertEquals(tasks[0].grants, []);
  assertEquals(tasks[0].delivery_channels, []);
  assert(!tasks[0].instruction.includes(PIN));
  await handler(request(args));
  assertEquals(tasks.length, 1);
  const context =
    await (await handler(request({}, VAPI_SECRET, "get_call_context"))).json();
  assert(context.results[0].result.includes("Europe/Sofia"));
  assert(context.results[0].result.includes("Connected services"));
  assert(!context.results[0].result.includes(PIN));
  const end = (secret = VAPI_SECRET) =>
    new Request("https://test/create-task", {
      method: "POST",
      headers: { "x-vapi-secret": secret },
      body: JSON.stringify({
        message: { type: "end-of-call-report", call: { id: "call-1" } },
      }),
    });
  assertEquals((await handler(end("wrong"))).status, 401);
  assertEquals(releases, 0);
  assertEquals(await (await handler(end())).json(), { released: 1 });
  assertEquals(await (await handler(end())).json(), { released: 0 });
  assertEquals(releases, 1);
});

Deno.test("voice: phone mode needs no PIN/question; spoofed model numbers and browser caller IDs cannot select an account", async () => {
  const { authenticateCaller } = await import(
    "../../functions/_shared/caller.ts"
  );
  const { checkAccess } = await import("../../functions/_shared/access.ts");
  const store = new FakeStore();
  const req = {
    callId: "phone-call",
    callType: "inboundPhoneCall",
    callMetadata: { user_id: "attacker" },
    customerNumber: USER_PHONE,
    toolCalls: [],
  };
  const auth = await authenticateCaller(
    store,
    { mode: "phone" },
    req,
    undefined,
  );
  assert(auth.ok);
  assertEquals(auth.profile.user_id, USER_ID);
  const access = await checkAccess(
    { store },
    req,
    auth,
    "create_calendar_event",
    {},
    undefined,
  );
  assert(access.ok);
  assertEquals(access.required, ["caller_id", "approval"]);
  assertEquals(access.satisfied, ["caller_id"]);
  assert(
    (await authenticateCaller(store, { mode: "phone" }, req, undefined)).ok,
  );
  assert(
    !(await authenticateCaller(store, { mode: "phone" }, {
      ...req,
      callId: "unknown",
      customerNumber: "+359899000000",
    }, undefined)).ok,
  );
  assert(
    !(await authenticateCaller(store, { mode: "phone" }, {
      ...req,
      callId: "browser",
      callType: "webCall",
    }, undefined)).ok,
  );
});
