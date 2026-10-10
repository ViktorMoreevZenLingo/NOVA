import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222";
export async function database() {
  const db = new PGlite();
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
 create table auth.users(id uuid primary key, phone text, phone_confirmed_at timestamptz, deleted_at timestamptz, raw_user_meta_data jsonb);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,service_role; grant select on auth.users to service_role;
 insert into auth.users values('${A}'),('${B}');`,
  );
  await db.exec(
    await Deno.readTextFile(
      new URL(
        "../../migrations/20261010094249_alo_accounts_and_activity.sql",
        import.meta.url,
      ),
    ),
  );
  await db.exec(
    await Deno.readTextFile(
      new URL(
        "../../migrations/20261010112556_delegated_manus_tasks.sql",
        import.meta.url,
      ),
    ),
  );
  await db.exec(
    await Deno.readTextFile(
      new URL(
        "../../migrations/20261010115706_task_write_receipts.sql",
        import.meta.url,
      ),
    ),
  );
  await db.exec(
    await Deno.readTextFile(
      new URL(
        "../../migrations/20261010121500_prepared_voice_actions.sql",
        import.meta.url,
      ),
    ),
  );
  await db.exec(
    await Deno.readTextFile(
      new URL(
        "../../migrations/20261010122000_task_initial_context.sql",
        import.meta.url,
      ),
    ),
  );
  return db;
}
export function submission(overrides: Record<string, unknown> = {}) {
  return {
    request_id: crypto.randomUUID(),
    request_hash: "hash",
    instruction: "Research test",
    start_mode: "now",
    timezone: "Europe/Sofia",
    grants: [],
    delivery_channels: [],
    ...overrides,
  };
}
export async function submit(db: PGlite, user = A, data = submission()) {
  return (await db.query<any>("select * from public.alo_task_submit($1,$2)", [
    user,
    JSON.stringify(data),
  ])).rows[0];
}
Deno.test("database: isolation, after-call race, idempotency, schedule, leases and cancellation", async () => {
  const db = await database();
  try {
    const data = submission({
      required_tools: ["send_email"],
      initial_read: {
        tool: "list_calendar_events",
        args: { from: "2026-10-12", to: "2026-10-18", max: 25 },
      },
    });
    const first = await submit(db, A, data);
    assertEquals(first.state.required_tools, ["send_email"]);
    assertEquals(first.state.initial_read.tool, "list_calendar_events");
    assertEquals((await submit(db, A, data)).id, first.id);
    await assertRejects(() =>
      submit(db, A, { ...data, request_hash: "changed" })
    );
    await db.exec(
      `insert into public.call_sessions(vapi_call_id,user_id,verified_at) values('call-a','${A}',now());`,
    );
    const waiting = await submit(
      db,
      A,
      submission({ call_id: "call-a", start_mode: "after_call" }),
    );
    assertEquals(waiting.status, "waiting_call");
    await assertRejects(() =>
      submit(db, B, submission({ call_id: "call-a", start_mode: "after_call" }))
    );
    await db.query("select public.alo_call_ended($1,$2)", [A, "call-a"]);
    const ended = await submit(
      db,
      A,
      submission({ call_id: "call-a", start_mode: "after_call" }),
    );
    assertEquals(ended.status, "queued");
    assertEquals(
      (await db.query<any>("select public.alo_call_ended($1,$2) as n", [
        A,
        "call-a",
      ])).rows[0].n,
      0,
    );
    const future = await submit(
      db,
      A,
      submission({ start_mode: "scheduled", run_at: "2099-01-01T00:00:00Z" }),
    );
    const claims = await Promise.all([
      db.query<any>("select * from public.alo_task_claim()"),
      db.query<any>("select * from public.alo_task_claim()"),
    ]);
    assert(claims[0].rows[0].id !== claims[1].rows[0].id);
    assert(claims.every((c) => c.rows[0].id !== future.id));
    const claimed = claims[0].rows[0];
    await db.query("select public.alo_task_command($1,$2,0,'cancel','{}')", [
      A,
      claimed.id,
    ]);
    await assertRejects(() =>
      db.query("select public.alo_step_begin($1,$2,'send','write')", [
        claimed.id,
        claimed.lease_id,
      ])
    );
    await db.query(
      'select public.alo_task_save($1,$2,\'{"status":"completed"}\')',
      [claimed.id, claimed.lease_id],
    );
    assertEquals(
      (await db.query<any>("select status from public.alo_tasks where id=$1", [
        claimed.id,
      ])).rows[0].status,
      "cancelled",
    );
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${B}';`);
    assertEquals(
      (await db.query("select * from public.alo_tasks")).rows.length,
      0,
    );
    assertEquals(
      (await db.query("select * from public.activity")).rows.length,
      0,
    );
    await assertRejects(() => db.query("select public.alo_task_claim()"));
    await assertRejects(() => db.query("select * from public.alo_task_steps"));
    await assertRejects(() =>
      db.query("update public.alo_tasks set user_id=$1", [B])
    );
    await db.exec("reset role;");
    await db.exec(`set role service_role;`);
    assert((await db.query("select * from public.alo_tasks")).rows.length > 0);
  } finally {
    await db.close();
  }
});
Deno.test("database: approval binds exact persisted args; delivery is separate and not reissued", async () => {
  const db = await database();
  try {
    const t = await submit(
      db,
      A,
      submission({ delivery_channels: ["email", "sms"] }),
    );
    await db.query(
      `update public.alo_tasks set status='needs_input',pending=$2 where id=$1`,
      [
        t.id,
        JSON.stringify({
          kind: "approval",
          tool: "send_email",
          args: { to: "a@example.com", subject: "Test", body: "Body" },
        }),
      ],
    );
    const revision = (await db.query<any>(
      "select revision from public.alo_tasks where id=$1",
      [t.id],
    )).rows[0].revision;
    await assertRejects(() =>
      db.query("select public.alo_task_command($1,$2,$3,'approve','{}')", [
        B,
        t.id,
        revision,
      ])
    );
    await assertRejects(() =>
      db.query("select public.alo_task_command($1,$2,$3,'approve','{}')", [
        A,
        t.id,
        revision - 1,
      ])
    );
    const approved = (await db.query<any>(
      "select * from public.alo_task_command($1,$2,$3,'approve','{}')",
      [A, t.id, revision],
    )).rows[0];
    assertEquals(approved.grants[0].constraints.to, "a@example.com");
    await db.query(
      "update public.alo_tasks set status='completed',result='Result' where id=$1",
      [t.id],
    );
    await db.query("update public.alo_tasks set result='Result' where id=$1", [
      t.id,
    ]);
    assertEquals(
      (await db.query("select * from public.alo_task_deliveries")).rows.length,
      2,
    );
    const delivery =
      (await db.query<any>("select * from public.alo_delivery_claim('email')"))
        .rows[0];
    await db.query(
      "update public.alo_task_deliveries set lease_until=now()-interval '1 second' where id=$1",
      [delivery.id],
    );
    assertEquals(
      (await db.query("select * from public.alo_delivery_claim('email')")).rows
        .length,
      0,
    );
    assertEquals(
      (await db.query<any>(
        "select status from public.alo_task_deliveries where id=$1",
        [delivery.id],
      )).rows[0].status,
      "uncertain",
    );
  } finally {
    await db.close();
  }
});

Deno.test("database: prepared actions wait for exact approval and retain after-call/scheduled conditions", async () => {
  const db = await database();
  try {
    await db.exec(
      `insert into public.call_sessions(vapi_call_id,user_id,verified_at) values('prepared-call','${A}',now());`,
    );
    const action = {
      tool: "create_calendar_event",
      args: {
        title: "Meeting",
        start: "2026-10-20T19:00:00+03:00",
        end: "2026-10-20T20:00:00+03:00",
      },
    };
    for (const mode of ["now", "after_call", "scheduled"]) {
      const t = await submit(
        db,
        A,
        submission({
          start_mode: mode,
          call_id: "prepared-call",
          run_at: mode === "scheduled" ? "2099-01-01T09:00:00Z" : null,
          prepared_action: action,
        }),
      );
      assertEquals(t.status, "needs_input");
      assertEquals(t.state.direct, true);
      assertEquals(t.pending.args, action.args);
      assertEquals(t.grants, []);
      const approved = (await db.query<any>(
        "select * from public.alo_task_command($1,$2,$3,'approve','{}')",
        [A, t.id, t.revision],
      )).rows[0];
      assertEquals(
        approved.status,
        mode === "after_call"
          ? "waiting_call"
          : mode === "scheduled"
          ? "scheduled"
          : "queued",
      );
      assertEquals(approved.grants[0].constraints, action.args);
    }
    await db.query("select public.alo_call_ended($1,'prepared-call')", [A]);
    assertEquals(
      (await db.query<any>(
        "select status from public.alo_tasks where start_mode='after_call'",
      )).rows[0].status,
      "queued",
    );
  } finally {
    await db.close();
  }
});
Deno.test("database: phone matching prefers confirmed account and rejects anonymous ambiguity", async () => {
  const db = await database();
  try {
    await db.query("update auth.users set raw_user_meta_data=$1", [
      JSON.stringify({ contact_phone: "+359 879 576 787" }),
    ]);
    assertEquals(
      (await db.query<any>(
        "select public.nova_user_id_by_phone('+359879576787') id",
      )).rows[0].id,
      null,
    );
    await db.query(
      "update auth.users set phone='+359879576787',phone_confirmed_at=now() where id=$1",
      [A],
    );
    assertEquals(
      (await db.query<any>(
        "select public.nova_user_id_by_phone('359879576787') id",
      )).rows[0].id,
      A,
    );
    assertEquals(
      (await db.query<any>(
        "select public.nova_user_id_by_phone('359899000000') id",
      )).rows[0].id,
      null,
    );
  } finally {
    await db.close();
  }
});
