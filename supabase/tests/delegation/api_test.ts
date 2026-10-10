import { assertEquals } from "jsr:@std/assert@1.0.19";
import { taskHandler } from "../../functions/tasks/handler.ts";
import type { Task } from "../../functions/_shared/delegation/contracts.ts";
Deno.env.set("APP_URL", "http://localhost:3000");
function fixture() {
  const calls: Record<string, unknown> = {
    valid: { user_id: "owner", verified_at: new Date().toISOString() },
    expired: { user_id: "owner", verified_at: "2000-01-01" },
    unverified: { user_id: "owner", verified_at: null },
  };
  const task = {
    id: "task",
    user_id: "owner",
    status: "running",
    state: {},
    revision: 1,
  } as Task;
  let mutations = 0;
  const db = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return builder;
        },
        maybeSingle: async () => ({
          error: null,
          data: table === "call_sessions"
            ? calls[String(filters.vapi_call_id)] ?? null
            : table === "alo_tasks" && filters.user_id === task.user_id &&
                filters.id === task.id
            ? task
            : null,
        }),
        then: (resolve: (v: unknown) => void) =>
          resolve({ error: null, data: [] }),
      };
      return builder;
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      mutations++;
      return {
        error: null,
        data: name === "alo_task_submit"
          ? { ...task, ...(args.p_data as object), user_id: args.p_user }
          : task,
      };
    },
  };
  const auth = async (req: Request) => {
    if (req.headers.get("authorization") !== "Bearer browser") {
      throw new Error("Invalid session");
    }
    return { user: { id: "browser-owner" }, token: "browser" };
  };
  // Structural fake at the Supabase boundary; taskHandler still exercises all auth and validation.
  const handler = taskHandler("service", db as never, auth as never);
  return {
    handler,
    get mutations() {
      return mutations;
    },
  };
}
const request = (body: object, token = "service") =>
  new Request("http://local/tasks", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
Deno.test("API: only verified service calls resolve ownership, never caller-supplied user IDs", async () => {
  const f = fixture();
  const base = {
    action: "submit",
    request_id: "key",
    instruction: "Research",
    user_id: "attacker",
  };
  for (const call_id of ["missing", "expired", "unverified"]) {
    assertEquals((await f.handler(request({ ...base, call_id }))).status, 403);
  }
  const accepted = await f.handler(request({ ...base, call_id: "valid" }));
  assertEquals(accepted.status, 202);
  assertEquals((await accepted.json()).acknowledgement, "running");
  assertEquals(f.mutations, 1);
});
Deno.test("API: browser cannot forge call ownership or claim delivery; task reads are owner scoped", async () => {
  const f = fixture();
  assertEquals(
    (await f.handler(
      request({
        action: "submit",
        call_id: "valid",
        request_id: "1",
        instruction: "Test",
      }, "browser"),
    )).status,
    403,
  );
  assertEquals(
    (await f.handler(
      request({ action: "end_call", call_id: "valid" }, "browser"),
    )).status,
    403,
  );
  assertEquals(
    (await f.handler(
      request({ action: "claim_delivery", channel: "sms" }, "browser"),
    )).status,
    403,
  );
  assertEquals(
    (await f.handler(request({ action: "get", task_id: "task" }, "browser")))
      .status,
    404,
  );
  assertEquals(
    (await f.handler(
      request({ action: "get", task_id: "task", call_id: "valid" }),
    )).status,
    200,
  );
  assertEquals(f.mutations, 0);
});
