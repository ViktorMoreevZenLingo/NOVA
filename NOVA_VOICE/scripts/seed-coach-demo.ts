// Seeds the hackathon demo org "Northwind (demo)": 4 departments, ~30 synthetic employees,
// 8 weekly pulse campaigns of anonymous answers with realistic trends, one published action
// ("You said, we did") and an open pulse for this week. Re-running replaces the demo org.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   DEMO_EMPLOYEE_PHONE=+3598... DEMO_MANAGER_PHONE=+3598... DEMO_LEADER_PHONE=+3598... [DEMO_HR_PHONE=+3598...] \
//   [DEMO_EXTRA_EMPLOYEE_PHONES=+3598...,+3598...] [DEMO_MANAGER_DISPLAY=...] [DEMO_LEADER_DISPLAY=...] [DEMO_HR_DISPLAY=...] \
//   [DEMO_MANAGER_NAME=Alex] [DEMO_MANAGER_EMAIL=manager@example.com] [DEMO_COACH_HISTORY=1] \
//   deno run --allow-env --allow-net scripts/seed-coach-demo.ts
//
// Phones must belong to existing NOVA accounts. Synthetic employees are auth users with
// @example.invalid emails and no phone, so they can never be called.
import { createClient } from "jsr:@supabase/supabase-js@2";

const env = (name: string, required = true) => {
  const v = Deno.env.get(name);
  if (required && !v) throw new Error(`Missing ${name}`);
  return v ?? "";
};
const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

const ORG = "0d000000-0000-4000-8000-00000000d001";
const DEPTS = {
  sales: { id: "0d000000-0000-4000-8000-00000000d101", name: "Sales", size: 9 },
  eng: { id: "0d000000-0000-4000-8000-00000000d102", name: "Engineering", size: 11 },
  cs: { id: "0d000000-0000-4000-8000-00000000d103", name: "Customer Success", size: 8 },
  marketing: { id: "0d000000-0000-4000-8000-00000000d104", name: "Marketing", size: 4 },
};
type Dept = keyof typeof DEPTS;
const WEEKS = 8;

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

async function userByPhone(phone: string): Promise<string> {
  const id = check(await db.rpc("nova_user_id_by_phone", { p_phone: phone }), "phone lookup") as string | null;
  if (!id) throw new Error(`No NOVA account for ${phone}. Sign up in the app first.`);
  return id;
}

async function syntheticUsers(count: number): Promise<string[]> {
  const wanted = Array.from({ length: count }, (_, i) => `coach-demo-${String(i + 1).padStart(2, "0")}@example.invalid`);
  const existing = new Map<string, string>();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    for (const u of data.users) if (u.email) existing.set(u.email, u.id);
    if (data.users.length < 200) break;
  }
  const ids: string[] = [];
  for (const email of wanted) {
    let id = existing.get(email);
    if (!id) {
      const { data, error } = await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { synthetic: true } });
      if (error) throw error;
      id = data.user.id;
    }
    ids.push(id);
  }
  return ids;
}

// Deterministic pseudo-random numbers, so every seed tells the same story.
let state = 42;
const rand = () => (state = (state * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const pick = (p: number) => rand() < p;

/** Week 0 is the oldest. The Sales action lands after week 4. */
function profileFor(dept: Dept, week: number) {
  switch (dept) {
    case "sales":
      return week <= 4
        ? { eng: 66 - week * 4.5, concerns: { growth: 0.65, workload: 0.3, recognition: 0.2 }, strengths: { team: 0.4 }, attrition: 0.35 }
        : {
          eng: 50 + (week - 4) * 4.5,
          concerns: { growth: 0.65 - (week - 4) * 0.13, workload: 0.25 },
          strengths: { team: 0.45, growth: 0.1 * (week - 4) },
          attrition: 0.3 - (week - 4) * 0.06,
        };
    case "eng":
      return {
        eng: 72 + Math.sin(week) * 2,
        concerns: { workload: 0.35, tools: 0.3 },
        strengths: { team: 0.6, growth: 0.4 },
        attrition: 0.08,
      };
    case "cs":
      return {
        eng: 63 - week * 1.8,
        concerns: { workload: 0.55, wellbeing: 0.45, recognition: 0.25 },
        strengths: { team: 0.5 },
        attrition: 0.15 + week * 0.025,
      };
    case "marketing":
      return { eng: 70, concerns: { clarity: 0.5 }, strengths: { team: 0.5 }, attrition: 0.1 };
  }
}

function response(dept: Dept, week: number) {
  const p = profileFor(dept, week);
  const engagement = clamp(p.eng + (rand() - 0.5) * 16, 5, 98);
  const sentiment = clamp((engagement - 55) / 40 + (rand() - 0.5) * 0.3, -1, 1);
  const scoreIndex = clamp((engagement - 0.3 * (sentiment + 1) * 50) / 0.7, 0, 100);
  const scale = clamp(Math.round(1 + scoreIndex / 25), 1, 5);
  const concerns = Object.entries(p.concerns).filter(([, share]) => pick(share)).map(([t]) => t);
  const strengths = Object.entries(p.strengths).filter(([t, share]) => !concerns.includes(t) && pick(share)).map(([t]) => t);
  const attrition: string[] = [];
  if (pick(p.attrition)) {
    attrition.push(concerns.includes("growth") ? "no_growth" : concerns.includes("wellbeing") ? "burnout" : "considering_leaving");
  }
  return {
    scores: { week: scale, support: clamp(scale + (pick(0.5) ? 1 : 0), 1, 5) },
    score_index: Math.round(scoreIndex * 100) / 100,
    sentiment: Math.round(sentiment * 100) / 100,
    engagement: Math.round(engagement * 100) / 100,
    concerns,
    strengths,
    attrition_signals: attrition,
  };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

const employee = await userByPhone(env("DEMO_EMPLOYEE_PHONE"));
const manager = await userByPhone(env("DEMO_MANAGER_PHONE"));
const leader = await userByPhone(env("DEMO_LEADER_PHONE"));
const hr = env("DEMO_HR_PHONE", false) ? await userByPhone(env("DEMO_HR_PHONE")) : null;
// Other real people who join Sales as employees (they can answer the live pulse and use the coach).
const extraEmployees = await Promise.all(
  env("DEMO_EXTRA_EMPLOYEE_PHONES", false).split(",").map((p) => p.trim()).filter(Boolean).map(userByPhone),
);
const realEmployees = [employee, ...extraEmployees];
const everyone = [...realEmployees, manager, leader, hr].filter(Boolean);
if (new Set(everyone).size !== everyone.length) {
  throw new Error("Each demo role needs a different NOVA account.");
}

console.log("Resetting the demo org…");
check(await db.from("orgs").delete().eq("id", ORG), "delete org");
check(await db.from("orgs").insert({ id: ORG, name: "Northwind (demo)" }), "org");
check(await db.from("departments").insert(Object.values(DEPTS).map((d) => ({ id: d.id, org_id: ORG, name: d.name }))), "departments");

const total = Object.values(DEPTS).reduce((s, d) => s + d.size, 0) - realEmployees.length; // real employees are part of Sales
const synthetic = await syntheticUsers(total);
const members: {
  user_id: string;
  department_id: string | null;
  manager_user_id: string | null;
  role: string;
  display_name: string | null;
}[] = [
  ...realEmployees.map((id) => ({
    user_id: id,
    department_id: DEPTS.sales.id,
    manager_user_id: manager,
    role: "employee",
    display_name: null,
  })),
  {
    user_id: manager,
    department_id: DEPTS.sales.id,
    manager_user_id: null,
    role: "manager",
    display_name: env("DEMO_MANAGER_DISPLAY", false) || null,
  },
  { user_id: leader, department_id: null, manager_user_id: null, role: "leader", display_name: env("DEMO_LEADER_DISPLAY", false) || null },
  ...(hr
    ? [{ user_id: hr, department_id: null, manager_user_id: null, role: "hr", display_name: env("DEMO_HR_DISPLAY", false) || null }]
    : []),
];
const byDept: Record<Dept, string[]> = { sales: [...realEmployees], eng: [], cs: [], marketing: [] };
let next = 0;
for (const [key, d] of Object.entries(DEPTS) as [Dept, typeof DEPTS[Dept]][]) {
  while (byDept[key].length < d.size) {
    const id = synthetic[next++];
    byDept[key].push(id);
    members.push({
      user_id: id,
      department_id: d.id,
      manager_user_id: key === "sales" ? manager : null,
      role: "employee",
      display_name: `Demo ${d.name} ${byDept[key].length}`,
    });
  }
}
// A user can belong to one org: move the demo accounts here.
check(await db.from("org_members").delete().in("user_id", members.map((m) => m.user_id)), "clear memberships");
check(await db.from("org_members").insert(members.map((m) => ({ ...m, org_id: ORG }))), "members");

console.log("Generating 8 weeks of anonymous pulse answers…");
const questions = check(await db.rpc("survey_default_questions", { p_kind: "pulse" }), "questions");
for (let week = 0; week < WEEKS; week++) {
  const start = daysAgo((WEEKS - week) * 7);
  const [campaign] = check(
    await db.from("survey_campaigns").insert({
      org_id: ORG,
      kind: "pulse",
      title: `Weekly pulse ${isoDay(start)}`,
      questions,
      department_ids: Object.values(DEPTS).map((d) => d.id),
      starts_at: start.toISOString(),
      ends_at: daysAgo((WEEKS - week) * 7 - 5).toISOString(),
      status: "closed",
      created_by: hr ?? leader,
    }).select("id"),
    "campaign",
  ) as { id: string }[];
  const invites: { campaign_id: string; user_id: string; status: string }[] = [];
  const responses: Record<string, unknown>[] = [];
  for (const [key, ids] of Object.entries(byDept) as [Dept, string[]][]) {
    for (const userId of ids) {
      const answered = pick(0.8);
      invites.push({ campaign_id: campaign.id, user_id: userId, status: answered ? "answered" : "declined" });
      if (answered) {
        responses.push({
          campaign_id: campaign.id,
          org_id: ORG,
          department_id: DEPTS[key].id,
          response_day: isoDay(new Date(start.getTime() + Math.floor(rand() * 4) * 86_400_000)),
          ...response(key, week),
        });
      }
    }
  }
  check(await db.from("survey_invites").insert(invites), "invites");
  check(await db.from("survey_responses").insert(responses), "responses");
}

console.log("Adding the published Sales action and this week's open pulse…");
const actionDay = daysAgo(3 * 7 + 2).toISOString();
check(
  await db.from("action_items").insert({
    org_id: ORG,
    department_id: DEPTS.sales.id,
    theme: "growth",
    title: "Project rotation and growth 1:1s in Sales",
    detail: "Every two weeks one person joins a cross-team project; each person has a development-focused 1:1 this month.",
    owner_user_id: manager,
    status: "in_progress",
    published: true,
    published_at: actionDay,
    created_at: actionDay,
  }),
  "action",
);
const [live] = check(
  await db.from("survey_campaigns").insert({
    org_id: ORG,
    kind: "pulse",
    title: "This week's pulse",
    questions,
    department_ids: Object.values(DEPTS).map((d) => d.id),
    ends_at: daysAgo(-5).toISOString(),
    status: "live",
    created_by: hr ?? leader,
  }).select("id"),
  "live campaign",
) as { id: string }[];
// Invites only for the real employees (synthetic users have no phone), and next_attempt_at
// far ahead so the worker does not call before the demo; they answer via "Answer now".
check(
  await db.from("survey_invites").insert(
    realEmployees.map((id) => ({ campaign_id: live.id, user_id: id, status: "pending", next_attempt_at: daysAgo(-30).toISOString() })),
  ),
  "live invites",
);

check(
  await db.from("coach_profiles").upsert({
    user_id: employee,
    manager_name: env("DEMO_MANAGER_NAME", false) || null,
    manager_email: env("DEMO_MANAGER_EMAIL", false) || null,
  }),
  "coach profile",
);
if (env("DEMO_COACH_HISTORY", false) === "1") {
  check(await db.from("coach_steps").delete().eq("user_id", employee), "clear steps");
  check(await db.from("coach_goals").delete().eq("user_id", employee), "clear goals");
  const [goal] = check(
    await db.from("coach_goals").insert({
      user_id: employee,
      title: "Take on more responsibility",
      why: "I want to grow beyond the same kind of tasks",
    })
      .select("id"),
    "goal",
  ) as { id: string }[];
  check(
    await db.from("coach_notes").insert({
      user_id: employee,
      goal_id: goal.id,
      kind: "blocker",
      text: "Nervous about proposing ideas in team meetings",
    }),
    "note",
  );
  check(
    await db.from("coach_steps").insert({
      user_id: employee,
      goal_id: goal.id,
      text: "Prepare one proposal for the next team meeting",
      due_at: daysAgo(-6).toISOString(),
    }),
    "step",
  );
}
console.log(`Done. Org ${ORG}: ${members.length} members, ${WEEKS} past pulses, 1 live pulse, 1 published action.`);
