import { assertEquals } from "jsr:@std/assert@1.0.19";
import { processTask } from "../../functions/_shared/delegation/worker.ts";
import type { Task } from "../../functions/_shared/delegation/contracts.ts";
import type { Step, Store } from "../../functions/_shared/delegation/store.ts";
import type {
  ManusClient,
  TaskEvent,
} from "../../functions/_shared/delegation/manus.ts";
function fixture() {
  let t = {
    id: "test",
    user_id: "user",
    instruction: "Research",
    status: "running",
    call_id: null,
    start_mode: "now",
    run_at: null,
    timezone: "Europe/Sofia",
    grants: [],
    delivery_channels: [],
    state: { phase: "create", round: 0 },
    pending: null,
    revision: 0,
    manus_task_id: null,
    manus_task_url: null,
    result: null,
    lease_id: "lease",
    cancel_requested: false,
    failures: 0,
    created_at: new Date().toISOString(),
  } as Task;
  const steps: Record<string, Step> = {};
  let creates = 0, writes = 0, stops = 0;
  let messages: TaskEvent[] = [];
  let services = ["gmail", "calendar", "contacts", "places", "outlook"];
  const store: Store = {
    claim: async () => t,
    get: async () => t,
    save: async (_t, p) => {
      t = { ...t, ...p } as Task;
    },
    begin: async (_t, k, kind) => {
      const existing = steps[k];
      if (!existing) steps[k] = { status: "started", output: null, kind };
      return { fresh: !existing, step: steps[k] };
    },
    finish: async (_t, k, output) => {
      steps[k] = { ...steps[k], status: "succeeded", output };
    },
    steps: async () => steps,
    context: async () => ({ profile: null, services }),
  };
  const manus: ManusClient = {
    createTask: async () => {
      creates++;
      return { taskId: "manus-1", taskUrl: null };
    },
    getTask: async () => ({
      id: "manus-1",
      status: "stopped",
      has_running_background_jobs: false,
    }),
    events: async () => messages,
    reply: async (_id, content) => {
      messages.unshift({ type: "user_message", user_message: { content } });
    },
    stop: async () => {
      stops++;
    },
    findCreated: async () =>
      creates ? { taskId: "manus-1", taskUrl: null } : null,
    latestAssistantMessage: async () => null,
    latestError: async () => null,
    publicKeyPem: async () => "",
  };
  const deps = {
    store,
    manus,
    runTool: async () => {
      writes++;
      return { id: "receipt" };
    },
  };
  return {
    get task() {
      return t;
    },
    steps,
    manus,
    store,
    deps,
    get creates() {
      return creates;
    },
    get writes() {
      return writes;
    },
    get stops() {
      return stops;
    },
    patch: (p: Partial<Task>) => {
      t = { ...t, ...p };
    },
    services: (s: string[]) => {
      services = s;
    },
    events: (e: TaskEvent[]) => {
      messages = e;
    },
    run: () => processTask(structuredClone(t), deps),
  };
}
Deno.test("worker: persists create, consumes structured read, replies, and completes", async () => {
  const f = fixture();
  await f.run();
  assertEquals(f.creates, 1);
  assertEquals(f.task.state.phase, "poll");
  f.events([{
    type: "structured_output_result",
    timestamp: 1,
    structured_output_result: {
      // Live API may omit success when value is present.
      value: {
        kind: "read",
        tool: "search_contacts",
        args: '{"query":"Maria"}',
        text: "",
      },
    },
  }]);
  await f.run();
  await f.run();
  assertEquals(f.writes, 1);
  await f.run();
  assertEquals(f.task.state.phase, "poll");
  // The old structured event must never be consumed twice while the next turn is running.
  await f.run();
  assertEquals(f.writes, 1);
  f.events([{
    type: "structured_output_result",
    timestamp: 2,
    structured_output_result: {
      success: true,
      value: { kind: "done", tool: "", args: "{}", text: "Result" },
    },
  }]);
  await f.run();
  assertEquals(f.task.status, "completed");
  assertEquals(f.task.result, "Result");
});
Deno.test("worker: disallowed writes require exact approval; approved action executes once", async () => {
  const f = fixture();
  const args = { to: "a@example.com", subject: "Hi", body: "Summary" };
  f.patch({
    manus_task_id: "manus-1",
    state: {
      phase: "tools",
      round: 0,
      decision: {
        kind: "action",
        tool: "send_email",
        args: JSON.stringify(args),
        text: "",
      },
    },
  });
  await f.run();
  assertEquals(f.task.pending?.kind, "approval");
  assertEquals(f.writes, 0);
  f.patch({
    status: "running",
    pending: null,
    grants: [{
      tool: "send_email",
      constraints: { to: "a@example.com" },
      generated_fields: ["subject", "body"],
    }],
  });
  await f.run();
  assertEquals(f.writes, 1);
  // Simulate crash after provider response was journalled, before the task phase changed.
  f.patch({
    state: {
      phase: "tools",
      round: 0,
      decision: {
        kind: "action",
        tool: "send_email",
        args: JSON.stringify(args),
        text: "",
      },
    },
  });
  await f.run();
  assertEquals(f.writes, 1);
  // The grant cannot authorize a second send in a later reasoning turn.
  f.patch({
    state: {
      phase: "tools",
      round: 1,
      sequence: 2,
      decision: {
        kind: "action",
        tool: "send_email",
        args: JSON.stringify(args),
        text: "",
      },
    },
  });
  await f.run();
  assertEquals(f.task.pending?.kind, "approval");
  assertEquals(f.writes, 1);
});
Deno.test("worker: ambiguous writes, disconnected integrations, loop bounds and cancellation", async () => {
  const f = fixture();
  const args = { to: "a@example.com", subject: "Hi", body: "Summary" };
  f.patch({
    manus_task_id: "manus-1",
    grants: [{ tool: "send_email", constraints: args, generated_fields: [] }],
    state: {
      phase: "tools",
      round: 0,
      decision: {
        kind: "action",
        tool: "send_email",
        args: JSON.stringify(args),
        text: "",
      },
    },
  });
  f.steps["tool:0"] = { status: "started", output: null, kind: "write:0" };
  await f.run();
  assertEquals(f.task.pending?.kind, "uncertain");
  assertEquals(f.writes, 0);
  delete f.steps["tool:0"];
  f.services([]);
  await f.run();
  assertEquals(f.task.pending?.kind, "connection");
  f.patch({ state: { ...f.task.state, round: 8 } });
  await f.run();
  assertEquals(f.task.pending?.kind, "limit");
  f.patch({ cancel_requested: true, status: "cancelled" });
  await f.run();
  assertEquals(f.stops, 1);
  assertEquals(f.writes, 0);
});
Deno.test("worker: uncertain Manus submission is reconciled, never blindly recreated", async () => {
  const f = fixture();
  f.steps.create = { status: "started", output: null };
  await f.run();
  assertEquals(f.creates, 0);
  assertEquals(f.task.pending?.kind, "uncertain");
  f.manus.findCreated = async () => ({ taskId: "recovered", taskUrl: null });
  await f.run();
  assertEquals(f.creates, 0);
  assertEquals(f.task.manus_task_id, "recovered");
});
Deno.test("worker: failed structured output cannot mark a task complete", async () => {
  const f = fixture();
  f.patch({ manus_task_id: "m", state: { phase: "poll", round: 0 } });
  f.events([{
    type: "structured_output_result",
    structured_output_result: {
      success: false,
      value: { text: "pretend success" },
    },
  }]);
  await f.run();
  assertEquals(f.task.status, "failed");
});

Deno.test("worker: Manus completion cannot substitute for a required write receipt", async () => {
  const f = fixture();
  f.patch({
    manus_task_id: "m",
    state: { phase: "poll", round: 0, required_tools: ["send_email"] },
  });
  f.events([{
    type: "structured_output_result",
    structured_output_result: {
      value: { kind: "done", tool: "", args: "{}", text: "Email sent" },
    },
  }]);
  await f.run();
  assertEquals(f.task.status, "needs_input");
  assertEquals(f.task.result, null);
  f.steps["tool:0"] = {
    status: "succeeded",
    kind: "write:0",
    output: { id: "provider-receipt" },
  };
  f.patch({
    status: "running",
    state: { ...f.task.state, phase: "poll" },
    grants: [{
      tool: "send_email",
      constraints: { to: "a@example.com" },
      generated_fields: ["subject", "body"],
    }],
  });
  f.events([{
    type: "structured_output_result",
    timestamp: 2,
    structured_output_result: {
      value: { kind: "done", tool: "", args: "{}", text: "Email sent" },
    },
  }]);
  await f.run();
  assertEquals(f.task.status, "completed");
});
