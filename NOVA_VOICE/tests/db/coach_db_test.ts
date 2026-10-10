// Real Postgres (PGlite) checks for the coach + employee-voice migration: RLS, the
// k >= 5 anonymity floor, role scopes and the worker leases.
//   deno task test:db
import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";

const MIGRATIONS = [
  "20261010094249_alo_accounts_and_activity.sql",
  "20261010190000_coach_and_employee_voice.sql",
];

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ORG = id(900), SALES = id(901), ENG = id(902), SALES_EAST = id(903);
export const HR = id(1), LEADER = id(2), MANAGER = id(3), ENG_MANAGER = id(4);
/** Sales employees 10..16 (7 people), Engineering 20..22 (3 people). */
export const SALES_PEOPLE = [10, 11, 12, 13, 14, 15, 16].map(id);
export const ENG_PEOPLE = [20, 21, 22].map(id);

export async function coachDatabase() {
  const db = new PGlite();
  const users = [HR, LEADER, MANAGER, ENG_MANAGER, ...SALES_PEOPLE, ...ENG_PEOPLE];
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
    create table auth.users(id uuid primary key, phone text, phone_confirmed_at timestamptz, deleted_at timestamptz,
                            raw_user_meta_data jsonb, raw_app_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated, service_role; grant select on auth.users to service_role;
    grant usage on schema public to authenticated, service_role, anon;
    insert into auth.users(id) values ${users.map((u) => `('${u}')`).join(",")};`);
  for (const m of MIGRATIONS) {
    await db.exec(await Deno.readTextFile(new URL(`../../../supabase/migrations/${m}`, import.meta.url)));
  }
  await db.exec(`
    insert into orgs(id, name) values ('${ORG}', 'Demo Co');
    insert into departments(id, org_id, name) values ('${SALES}', '${ORG}', 'Sales'), ('${ENG}', '${ORG}', 'Engineering');
    insert into departments(id, org_id, parent_id, name) values ('${SALES_EAST}', '${ORG}', '${SALES}', 'Sales East');
    insert into org_members(user_id, org_id, department_id, role) values
      ('${HR}', '${ORG}', null, 'hr'), ('${LEADER}', '${ORG}', null, 'leader'),
      ('${MANAGER}', '${ORG}', '${SALES}', 'manager'), ('${ENG_MANAGER}', '${ORG}', '${ENG}', 'manager');
    insert into org_members(user_id, org_id, department_id, manager_user_id) values
      ${SALES_PEOPLE.map((u) => `('${u}', '${ORG}', '${SALES}', '${MANAGER}')`).join(",")},
      ${ENG_PEOPLE.map((u) => `('${u}', '${ORG}', '${ENG}', '${ENG_MANAGER}')`).join(",")};`);
  return db;
}

export async function as(db: PGlite, user: string | null) {
  await db.exec("reset role;");
  if (user === null) await db.exec("set role service_role; set request.jwt.claim.sub = '';");
  else await db.exec(`set role authenticated; set request.jwt.claim.sub = '${user}';`);
}

async function rows<T>(db: PGlite, sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

async function answer(db: PGlite, campaign: string, user: string, concerns = "{growth}", engagement = 60) {
  await as(db, null);
  return (await rows<{ ok: boolean }>(
    db,
    `select survey_record_response($1, $2, '{"week":3}', 50, null, -0.2, $3, $4::text[], '{team}', '{no_growth}') ok`,
    [user, campaign, engagement, concerns],
  ))[0].ok;
}

Deno.test("coach: personal memory is owner-only and follow-up columns are server-only", async () => {
  const db = await coachDatabase();
  const [a, b] = SALES_PEOPLE;
  await as(db, a);
  const [goal] = await rows<{ id: string }>(
    db,
    `insert into coach_goals(user_id, title) values ($1, 'Lead a small project') returning id`,
    [a],
  );
  const [step] = await rows<{ id: string; followup_status: string }>(
    db,
    `insert into coach_steps(user_id, goal_id, text, due_at) values ($1, $2, 'Bring one proposal', now() + interval '7 days')
     returning id, followup_status`,
    [a, goal.id],
  );
  assertEquals(step.followup_status, "scheduled", "a due date schedules the follow-up");
  await assertRejects(() => db.query(`update coach_steps set followup_status = 'none' where id = $1`, [step.id]));
  await assertRejects(() => db.query(`insert into coach_goals(user_id, title) values ($1, 'Not mine')`, [b]));

  await as(db, b);
  assertEquals((await rows(db, "select * from coach_goals")).length, 0, "another employee sees nothing");
  assertEquals((await rows(db, "select * from coach_steps")).length, 0);
  await as(db, MANAGER);
  assertEquals((await rows(db, "select * from coach_goals")).length, 0, "the manager sees nothing either");
  await as(db, HR);
  assertEquals((await rows(db, "select * from coach_steps")).length, 0, "nor does HR");

  await as(db, a);
  await db.query(`update coach_steps set status = 'done' where id = $1 and status = 'open'`, [step.id]);
  const [closed] = await rows<{ followup_status: string }>(db, "select followup_status from coach_steps where id = $1", [step.id]);
  assertEquals(closed.followup_status, "cancelled", "closing a step cancels its pending follow-up");
});

Deno.test("coach: only approved shares reach the manager; the employee sees the reply", async () => {
  const db = await coachDatabase();
  const [a] = SALES_PEOPLE;
  await as(db, null);
  const [share] = await rows<{ id: string }>(
    db,
    `insert into coach_shares(user_id, text, recipient_user_id) values ($1, 'I would like to take on a small project', $2) returning id`,
    [a, MANAGER],
  );
  await as(db, MANAGER);
  assertEquals((await rows(db, "select * from coach_shares")).length, 0, "drafts stay private");
  assertEquals((await rows<{ ok: boolean }>(db, "select coach_share_respond($1, 'planned') ok", [share.id]))[0].ok, false);

  await as(db, null);
  await db.query(`update coach_shares set status = 'approved', approved_via = 'app' where id = $1 and status = 'draft'`, [share.id]);
  await as(db, MANAGER);
  assertEquals((await rows(db, "select * from coach_shares")).length, 1);
  assertEquals(
    (await rows<{ ok: boolean }>(db, "select coach_share_respond($1, 'planned', 'Let us talk Thursday') ok", [share.id]))[0].ok,
    true,
  );
  const [req] = await rows<{ employee_name: string; text: string }>(db, "select * from coach_team_requests()");
  assertEquals(req.text, "I would like to take on a small project");
  assertEquals(req.employee_name, "A team member");
  await as(db, ENG_MANAGER);
  assertEquals((await rows(db, "select * from coach_team_requests()")).length, 0);
  assertEquals((await rows(db, "select * from coach_shares")).length, 0, "another manager never sees it");
  await as(db, a);
  const [mine] = await rows<{ manager_status: string; manager_note: string }>(db, "select manager_status, manager_note from coach_shares");
  assertEquals(mine.manager_status, "planned");
  assertEquals(mine.manager_note, "Let us talk Thursday");
});

Deno.test("surveys: responses are unreadable from the browser; aggregates need 5 answers", async () => {
  const db = await coachDatabase();
  await as(db, HR);
  const [{ cid }] = await rows<{ cid: string }>(db, "select insights_launch_campaign('pulse', 'Weekly pulse') cid");
  await as(db, null);
  assertEquals((await rows(db, "select * from survey_invites where campaign_id = $1", [cid])).length, 12, "every member is invited");

  await as(db, SALES_PEOPLE[0]);
  assertEquals((await rows(db, "select * from survey_invites")).length, 1, "an employee sees only their own invite");
  assertEquals((await rows(db, "select * from survey_campaigns")).length, 1, "and the campaign they were invited to");
  await assertRejects(() => db.query("select * from survey_responses"), Error, "permission denied");

  for (const u of SALES_PEOPLE.slice(0, 4)) assert(await answer(db, cid, u));
  assertEquals(await answer(db, cid, SALES_PEOPLE[0]), false, "one answer per person");

  await as(db, MANAGER);
  const before = await rows<{ name: string; suppressed: boolean; engagement: number | null }>(
    db,
    "select name, suppressed, engagement from insights_departments() where department_id = $1",
    [SALES],
  );
  assertEquals(before[0].suppressed, true, "4 answers are not enough");
  assertEquals(before[0].engagement, null);

  assert(await answer(db, cid, SALES_PEOPLE[4]));
  for (const u of ENG_PEOPLE) assert(await answer(db, cid, u, "{workload}"));

  await as(db, MANAGER);
  const sales = await rows<{ department_id: string | null; suppressed: boolean; engagement: string; concerns: Record<string, number> }>(
    db,
    "select department_id, suppressed, engagement, concerns from insights_departments()",
  );
  const salesRow = sales.find((r) => r.department_id === SALES)!;
  assertEquals(salesRow.suppressed, false);
  assertEquals(Number(salesRow.engagement), 60);
  assertEquals(salesRow.concerns.growth, 1);
  assert(!sales.some((r) => r.department_id === ENG), "a manager sees only their own subtree");
  assert(sales.some((r) => r.department_id === SALES_EAST), "including sub-teams");

  await as(db, HR);
  const org = await rows<{ department_id: string | null; suppressed: boolean; responses: number }>(
    db,
    "select department_id, suppressed, responses from insights_departments()",
  );
  assertEquals(org.find((r) => r.department_id === ENG)!.suppressed, true, "3 Engineering answers stay hidden");
  assertEquals(org.find((r) => r.department_id === null)!.responses, 8, "but count toward the org total");

  await as(db, SALES_PEOPLE[1]);
  assertEquals((await rows(db, "select * from insights_departments()")).length, 0, "employees get no aggregates");
  await assertRejects(() => db.query("select * from insights_trend($1)", [SALES]), Error, "not in scope");
});

Deno.test("surveys: the floor counts people, not answers (3 people answering weekly stay hidden)", async () => {
  const db = await coachDatabase();
  for (let week = 0; week < 3; week++) {
    await as(db, HR);
    const [{ cid }] = await rows<{ cid: string }>(db, "select insights_launch_campaign('pulse', $1, array[$2]::uuid[]) cid", [
      `W${week}`,
      ENG,
    ]);
    for (const u of ENG_PEOPLE) assert(await answer(db, cid, u, "{workload}"));
  }
  await as(db, HR);
  const [eng] = await rows<{ responses: number; suppressed: boolean; concerns: unknown }>(
    db,
    "select responses, suppressed, concerns from insights_departments() where department_id = $1",
    [ENG],
  );
  assertEquals(eng.responses, 9, "9 answers…");
  assertEquals(eng.suppressed, true, "…from only 3 people");
  assertEquals(eng.concerns, null);
  const trend = await rows<{ suppressed: boolean }>(db, "select * from insights_trend($1)", [ENG]);
  assert(trend.every((t) => t.suppressed));
});

Deno.test("surveys: manager_support appears only after two campaigns", async () => {
  const db = await coachDatabase();
  await as(db, HR);
  const [{ cid }] = await rows<{ cid: string }>(db, "select insights_launch_campaign('pulse', 'One') cid");
  for (const u of SALES_PEOPLE.slice(0, 5)) await answer(db, cid, u, "{manager_support}");
  await as(db, LEADER);
  const [one] = await rows<{ concerns: Record<string, number> }>(
    db,
    "select concerns from insights_departments() where department_id = $1",
    [SALES],
  );
  assertEquals(one.concerns.manager_support, undefined);

  await as(db, HR);
  const [{ cid: second }] = await rows<{ cid: string }>(db, "select insights_launch_campaign('pulse', 'Two') cid");
  await answer(db, second, SALES_PEOPLE[5], "{manager_support}");
  await as(db, LEADER);
  const [two] = await rows<{ concerns: Record<string, number> }>(
    db,
    "select concerns from insights_departments() where department_id = $1",
    [SALES],
  );
  assertEquals(two.concerns.manager_support, 1);
});

Deno.test("insights: role rules for campaigns and actions; published actions reach the right employees", async () => {
  const db = await coachDatabase();
  await as(db, MANAGER);
  await assertRejects(() => db.query("select insights_launch_campaign('engagement', 'x')"), Error, "pulse checks only");
  await assertRejects(() => db.query("select insights_launch_campaign('pulse', 'x', array[$1]::uuid[])", [ENG]), Error, "not in scope");
  await assertRejects(
    () => db.query("select insights_save_action(null, null, null, 'growth', 'Org-wide', null, 'planned', true)"),
    Error,
    "own team",
  );
  const [{ aid }] = await rows<{ aid: string }>(
    db,
    "select insights_save_action(null, $1, null, 'growth', 'Project rotation', 'Two-week rotations', 'in_progress', true) aid",
    [SALES],
  );
  assert(aid);
  await as(db, SALES_PEOPLE[0]);
  assertEquals((await rows(db, "select * from action_items")).length, 1, "Sales sees the published Sales action");
  await as(db, ENG_PEOPLE[0]);
  assertEquals((await rows(db, "select * from action_items")).length, 0, "Engineering does not");
  await as(db, SALES_PEOPLE[0]);
  await assertRejects(() => db.query("select insights_launch_campaign('pulse', 'x')"), Error, "not allowed");
});

Deno.test("worker: due follow-ups are leased once", async () => {
  const db = await coachDatabase();
  await as(db, null);
  await db.query(`insert into coach_steps(user_id, text, due_at) values ($1, 'Due now', now() - interval '1 minute')`, [SALES_PEOPLE[0]]);
  await db.query(`insert into coach_steps(user_id, text, due_at) values ($1, 'Later', now() + interval '1 day')`, [SALES_PEOPLE[0]]);
  const first = await rows<{ text: string; followup_status: string; followup_attempts: number }>(
    db,
    "select * from coach_claim_followups(10)",
  );
  assertEquals(first.map((r) => r.text), ["Due now"]);
  assertEquals(first[0].followup_status, "calling");
  assertEquals(first[0].followup_attempts, 1);
  assertEquals((await rows(db, "select * from coach_claim_followups(10)")).length, 0, "no double call");
  await as(db, SALES_PEOPLE[0]);
  await assertRejects(() => db.query("select * from coach_claim_followups(10)"), Error, "permission denied");
});

Deno.test("insights: weekly trend and before/after impact of an action", async () => {
  const db = await coachDatabase();
  await as(db, HR);
  const [{ cid }] = await rows<{ cid: string }>(db, "select insights_launch_campaign('pulse', 'Trend') cid");
  await as(db, MANAGER);
  const [{ aid }] = await rows<{ aid: string }>(
    db,
    "select insights_save_action(null, $1, null, 'growth', 'Project rotation', null, 'in_progress', true) aid",
    [SALES],
  );
  await as(db, null);
  await db.query("update action_items set created_at = now() - interval '14 days' where id = $1", [aid]);
  // Before the action: 5 answers, growth everywhere, low engagement. After: 5 better answers.
  for (let i = 0; i < 5; i++) {
    await db.query(
      `insert into survey_responses(campaign_id, org_id, department_id, response_day, engagement, concerns)
       values ($1, $2, $3, current_date - 20, 40, '{growth}'), ($1, $2, $3, current_date - 3, 70, $4::text[])`,
      [cid, ORG, SALES, i < 1 ? "{growth}" : "{}"],
    );
  }
  await as(db, LEADER);
  const [impact] = await rows<
    { before_engagement: string; after_engagement: string; before_theme_share: string; after_theme_share: string }
  >(
    db,
    "select * from insights_action_impact() where action_id = $1",
    [aid],
  );
  assertEquals(Number(impact.before_engagement), 40);
  assertEquals(Number(impact.after_engagement), 70);
  assertEquals(Number(impact.before_theme_share), 1);
  assertEquals(Number(impact.after_theme_share), 0.2);

  const trend = await rows<{ responses: number; suppressed: boolean }>(db, "select * from insights_trend($1, 12)", [SALES]);
  assertEquals(trend.map((t) => t.responses), [10], "one point per check-in, by its start week");
  assert(trend.every((t) => !t.suppressed));
  await as(db, ENG_MANAGER);
  assertEquals((await rows(db, "select * from insights_action_impact()")).length, 0, "other managers don't see Sales actions");
});
