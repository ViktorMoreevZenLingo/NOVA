import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { coachToolsHandler } from "../../supabase/functions/coach-tools/handler.ts";
import { coachApiHandler } from "../../supabase/functions/coach/handler.ts";
import { coachWorkerHandler } from "../../supabase/functions/coach-worker/handler.ts";
import { analyzeAnswers, engagementIndex, keywordClassifier, sanitize } from "../../supabase/functions/_shared/coach/analysis.ts";
import { createShareDelivery } from "../../supabase/functions/_shared/coach/delivery.ts";
import { playbookRecommendations } from "../../supabase/functions/_shared/coach/insights.ts";
import { inCallWindow, nextCallWindow, type OutboundCall, runCoachWorker } from "../../supabase/functions/_shared/coach/outbound.ts";
import { COACH_TOOLS, followupFirstMessage, PULSE_TOOLS } from "../../supabase/functions/_shared/coach/prompts.ts";
import { coachTools, type DeliverShare } from "../../supabase/functions/_shared/coach/service.ts";
import { CAMPAIGN, FakeCoachStore, MANAGER_ID } from "./coach_fakes.ts";
import { FakeStore, USER_ID, USER_PHONE, VAPI_SECRET, vapiRequest } from "./fakes.ts";

const neutral = () => Promise.resolve({ sentiment: -0.5, concerns: ["growth" as const], strengths: [], attritionSignals: ["no_growth"] });

function setup(opts: { deliver?: DeliverShare } = {}) {
  const store = new FakeCoachStore();
  const delivered: string[] = [];
  const deliverShare: DeliverShare = opts.deliver ?? ((share) => {
    delivered.push(share.id);
    return Promise.resolve("in_app");
  });
  const tools = coachTools({ store, classify: neutral, deliverShare, now: () => new Date("2026-10-12T08:00:00Z") });
  const handler = coachToolsHandler({ taskStore: new FakeStore(), tools }, { vapiSecret: VAPI_SECRET });
  return { store, tools, handler, delivered };
}

async function call(
  handler: (r: Request) => Promise<Response>,
  name: string,
  args: Record<string, unknown> = {},
  opts: Parameters<typeof vapiRequest>[1] & { id?: string } = {},
) {
  const res = await handler(vapiRequest([{ id: opts.id ?? `tc-${name}-${Math.random()}`, name, args }], opts));
  assertEquals(res.status, 200);
  return (await res.json()).results[0] as { result?: string; error?: string };
}

Deno.test("coach-tools: every tool in the prompts is implemented", () => {
  const { tools } = setup();
  for (const t of [...COACH_TOOLS, ...PULSE_TOOLS]) assert(tools[t.name], `missing ${t.name}`);
});

Deno.test("coach-tools: rejects a wrong secret, unknown callers and browser calls", async () => {
  const { handler, store } = setup();
  assertEquals((await handler(vapiRequest([{ id: "x", name: "coach_recall", args: {} }], { secret: "nope" }))).status, 401);
  assertMatch((await call(handler, "coach_recall", {}, { number: "+15550009999" })).error!, /not linked/);
  assertMatch((await call(handler, "coach_recall", {}, { callType: "webCall" })).error!, /not linked/);
  // Arguments can never pick another account.
  await call(handler, "coach_save_goal", { title: "Grow", user_id: MANAGER_ID });
  assertEquals(store.goals[0].user_id, USER_ID);
});

Deno.test("coach-tools: also accepts the delegation secret when configured, nothing else", async () => {
  const store = new FakeCoachStore();
  const tools = coachTools({ store, classify: neutral, deliverShare: () => Promise.resolve("in_app") });
  const handler = coachToolsHandler({ taskStore: new FakeStore(), tools }, {
    vapiSecret: VAPI_SECRET,
    additionalVapiSecret: "delegation-secret",
  });
  const req = (secret: string) => vapiRequest([{ id: "x", name: "coach_recall", args: {} }], { secret });
  assertEquals((await handler(req(VAPI_SECRET))).status, 200);
  assertEquals((await handler(req("delegation-secret"))).status, 200);
  assertEquals((await handler(req("wrong"))).status, 401);
});

Deno.test("coach-tools: first conversation → goal, note, one step with a follow-up", async () => {
  const { handler, store } = setup();
  assertMatch((await call(handler, "coach_recall")).result!, /first conversation/);
  const goal = await call(handler, "coach_save_goal", { title: "Take on more responsibility", why: "I want to grow" });
  const goalId = goal.result!.match(/goal:([0-9a-f-]{36})/)![1];
  await call(handler, "coach_save_note", { kind: "blocker", text: "Nervous about proposing ideas in meetings", goal_id: goalId });
  const step = await call(handler, "coach_commit_step", {
    text: "Prepare one proposal for the next team meeting",
    due_in_days: 7,
    goal_id: goalId,
  }, { id: "tc-step" });
  assertMatch(step.result!, /due 2026-10-19/);
  assertMatch(step.result!, /NOVA will call/);
  // A retried tool call does not create a second step.
  await call(handler, "coach_commit_step", { text: "Prepare one proposal for the next team meeting", due_in_days: 7 }, { id: "tc-step" });
  assertEquals(store.steps.length, 1);
  assertEquals(store.steps[0].goal_id, goalId);
  assertEquals(store.steps[0].followup_status, "scheduled");
  assertEquals(store.notes[0].kind, "blocker");

  const recall = (await call(handler, "coach_recall")).result!;
  assertMatch(recall, /Take on more responsibility/);
  assertMatch(recall, /Prepare one proposal.*due in 7 day/);
  assertMatch(recall, /You said, we did[\s\S]*Project rotation/);
});

Deno.test("coach-tools: outcome is recorded once and cancels the pending follow-up", async () => {
  const { handler, store } = setup();
  await call(handler, "coach_commit_step", { text: "Present the idea", due_in_days: 3 });
  const r = await call(handler, "coach_record_outcome", { status: "done", outcome: "Presented it; the team liked it" });
  assertMatch(r.result!, /is done/);
  assertEquals(store.steps[0].followup_status, "cancelled");
  assertMatch((await call(handler, "coach_record_outcome", { status: "partial", outcome: "x" })).result!, /No open step/);
});

Deno.test("coach-tools: sharing needs a configured manager, a read-back in this call and a yes", async () => {
  const { handler, store, delivered } = setup();
  store.memberships.clear();
  assertMatch((await call(handler, "coach_propose_share", { text: "I would like a small project" })).result!, /No manager/);
  assertEquals(store.shares.length, 0);

  const s = setup();
  const draft = await call(s.handler, "coach_propose_share", { text: "I would like to take on a small project" }, { callId: "call-A" });
  assertMatch(draft.result!, /NOT sent[\s\S]*word for word: "I would like to take on a small project"/);
  assertEquals(s.store.shares[0].recipient_user_id, MANAGER_ID, "recipient comes from org_members, not the model");
  assertEquals(s.store.shares[0].status, "draft");

  // A different call cannot approve it.
  assertMatch((await call(s.handler, "coach_decide_share", { approve: true }, { callId: "call-B" })).result!, /no draft/i);
  assertEquals(s.store.shares[0].status, "draft");
  assertMatch((await call(s.handler, "coach_decide_share", { approve: true }, { callId: "call-A" })).result!, /Approved/);
  assertEquals(s.store.shares[0].status, "approved");
  assertEquals(s.store.shares[0].approved_via, "call");
  assertEquals(s.delivered.length, 1);
  assertMatch((await call(s.handler, "coach_decide_share", { approve: true }, { callId: "call-A" })).result!, /no draft/i);
  assertEquals(delivered.length, 0);
});

Deno.test("delivery: email failure releases the lease; no email address stays in-app", async () => {
  const store = new FakeCoachStore();
  const share = await store.insertShare({
    user_id: USER_ID,
    goal_id: null,
    text: "Small project please",
    recipient_user_id: MANAGER_ID,
    recipient_email: "boss@example.com",
    source_call_id: "c",
    source_tool_call_id: "t",
  });
  await store.transitionShare(share.id, ["draft"], { status: "approved" });
  const failing = createShareDelivery({ store, sendEmail: () => Promise.reject(new Error("smtp down")) });
  assertEquals(await failing(share), "in_app");
  assertEquals(store.shares[0].status, "approved");
  const sent: { to: string; body: string }[] = [];
  const working = createShareDelivery({
    store,
    sendEmail: (_u, mail) => {
      sent.push(mail);
      return Promise.resolve(true);
    },
  });
  assertEquals(await working(store.shares[0]), "emailed");
  assertEquals(store.shares[0].status, "sent");
  assertEquals(sent[0].to, "boss@example.com");
  assertMatch(sent[0].body, /Only this text was shared/);
  assertEquals(await working(store.shares[0]), "in_app", "never sent twice");
  assertEquals(sent.length, 1);
});

Deno.test("survey: anonymous submit stores numbers and closed themes only, once", async () => {
  const { handler, store } = setup();
  assertMatch((await call(handler, "survey_get_questions")).result!, /no open survey/);
  store.invites.push({ campaign_id: CAMPAIGN.id, user_id: USER_ID, status: "pending", attempts: 0 });
  const q = (await call(handler, "survey_get_questions")).result!;
  assertMatch(q, /1\. \[week\] \(number 1-5\)/);
  assertEquals(store.invites[0].status, "called");

  const answers = [
    { question_id: "week", score: 2, text: "Same tasks every week, my manager Ivan never listens" },
    { question_id: "enps", score: 11 },
    { question_id: "better", text: "More variety" },
    { question_id: "nope", score: 5 },
  ];
  const r = (await call(handler, "survey_submit", { answers })).result!;
  assertMatch(r, /anonymously/);
  assertMatch(r, /Project rotation/);
  const saved = store.responses[0].record;
  assertEquals(saved.scores, { week: 2 });
  assertEquals(saved.enps, 10, "clamped");
  assertEquals(saved.concerns, ["growth"]);
  assert(!JSON.stringify(saved).includes("Ivan"), "free text never stored");
  assertMatch((await call(handler, "survey_submit", { answers })).result!, /no open survey/);
  assertEquals(store.responses.length, 1);
});

Deno.test("survey: decline records nothing", async () => {
  const { handler, store } = setup();
  store.invites.push({ campaign_id: CAMPAIGN.id, user_id: USER_ID, status: "pending", attempts: 0 });
  assertMatch((await call(handler, "survey_decline")).result!, /Declined/);
  assertEquals(store.invites[0].status, "declined");
  assertEquals(store.responses.length, 0);
});

Deno.test("analysis: closed lists, language-adjusted engagement, keyword fallback", async () => {
  assertEquals(sanitize({ sentiment: 7, concerns: ["growth", "salary rant", "growth"] as never, strengths: ["growth", "team"] as never }), {
    sentiment: 1,
    concerns: ["growth"],
    strengths: ["team"],
    attritionSignals: [],
  });
  assertEquals(engagementIndex(75, null), 75);
  assertEquals(engagementIndex(75, -1), 52.5, "a 4/5 said in exhausted words lands lower");
  assertEquals(engagementIndex(null, null), null);
  const r = await analyzeAnswers(CAMPAIGN.questions, [{
    question_id: "better",
    text: "I am exhausted and thinking to quit, too much work",
  }], () => {
    throw new Error("LLM down");
  });
  assert(r.concerns.includes("workload"));
  assert(r.attritionSignals.includes("considering_leaving"));
  assert(r.sentiment! < 0);
  assertEquals(keywordClassifier("I love my team, great support").strengths.includes("team"), true);
  // A real pulse answer from the first live call: mixed, so not maximally negative, and workload is caught.
  const mixed = keywordClassifier(
    "I get the same kind of tasks every week, and I'm not learning much.\nToo many meetings. I had no time for focused work. The project rotation ideas help motivate me.",
  );
  assert(mixed.concerns.includes("workload") && mixed.concerns.includes("growth"));
  assert(mixed.sentiment > -1 && mixed.sentiment < 0);
});

Deno.test("call window: local hours and weekdays in the employee's timezone", () => {
  const profile = { call_days: [1, 2, 3, 4, 5], call_from: "09:30", call_to: "18:30", timezone: "Europe/Sofia" };
  assert(inCallWindow(profile, new Date("2026-10-12T07:00:00Z")), "Mon 10:00 Sofia");
  assert(!inCallWindow(profile, new Date("2026-10-12T05:00:00Z")), "Mon 08:00 Sofia");
  assert(!inCallWindow(profile, new Date("2026-10-11T09:00:00Z")), "Sunday");
  assertEquals(
    nextCallWindow(profile, new Date("2026-10-10T12:00:00Z")).toISOString(),
    "2026-10-12T06:30:00.000Z",
    "Saturday → Monday 09:30",
  );
});

Deno.test("worker: defers outside the window, calls inside it, retries then fails", async () => {
  const store = new FakeCoachStore();
  await store.insertStep(USER_ID, { text: "Bring one proposal", due_at: "2026-10-01T00:00:00Z", source_tool_call_id: "s1" });
  const calls: OutboundCall[] = [];
  let fail = false;
  const dial = (c: OutboundCall) => {
    if (fail) return Promise.reject(new Error("busy"));
    calls.push(c);
    return Promise.resolve("vapi-call-1");
  };
  const saturday = () => new Date("2026-10-10T12:00:00Z");
  const r1 = await runCoachWorker({ store, dial, now: saturday });
  assertEquals(r1.deferred, 1);
  assertEquals(store.steps[0].followup_status, "scheduled");
  assertEquals(store.steps[0].followup_at, "2026-10-12T06:30:00.000Z");
  assertEquals(calls.length, 0);

  store.steps[0].followup_at = "2026-10-01T00:00:00Z";
  const monday = () => new Date("2026-10-12T08:00:00Z");
  const r2 = await runCoachWorker({ store, dial, now: monday, employeeName: () => Promise.resolve("Maria Ivanova") });
  assertEquals(r2.followups, 1);
  assertEquals(calls[0].phone, USER_PHONE);
  assertEquals(calls[0].assistant, "coach");
  assertEquals(calls[0].firstMessage, followupFirstMessage("Maria", "Bring one proposal"));
  assertEquals(store.steps[0].followup_status, "called");

  await store.insertStep(USER_ID, { text: "Ask for feedback", due_at: "2026-10-01T00:00:00Z", source_tool_call_id: "s2" });
  fail = true;
  await runCoachWorker({ store, dial, now: monday });
  assertEquals(store.steps[1].followup_status, "scheduled", "first failure retries");
  store.steps[1].followup_at = "2026-10-01T00:00:00Z";
  await runCoachWorker({ store, dial, now: monday });
  assertEquals(store.steps[1].followup_status, "failed", "second failure stops");
});

Deno.test("worker: respects switched-off follow-ups and surveys; endpoint needs the cron secret", async () => {
  const store = new FakeCoachStore();
  store.profiles.set(USER_ID, { ...(await store.profile(USER_ID)), followups_enabled: false, surveys_enabled: false });
  await store.insertStep(USER_ID, { text: "x", due_at: "2026-10-01T00:00:00Z", source_tool_call_id: "s" });
  store.invites.push({ campaign_id: CAMPAIGN.id, user_id: USER_ID, status: "pending", attempts: 0 });
  const dial = () => Promise.reject(new Error("must not call"));
  const report = await runCoachWorker({ store, dial, now: () => new Date("2026-10-12T08:00:00Z") });
  assertEquals(report.skipped, 2);
  assertEquals(store.steps[0].followup_status, "cancelled");
  assertEquals(store.invites[0].status, "declined");

  const worker = coachWorkerHandler({ store, dial }, { cronSecret: "cron" });
  assertEquals((await worker(new Request("http://x", { method: "POST", headers: { authorization: "Bearer bad" } }))).status, 401);
  assertEquals((await worker(new Request("http://x", { method: "POST", headers: { authorization: "Bearer cron" } }))).status, 200);
});

function api(store = new FakeCoachStore(), dial: ((c: OutboundCall) => Promise<string>) | null = null, user = USER_ID) {
  const deliverShare: DeliverShare = () => Promise.resolve("in_app");
  const tools = coachTools({ store, classify: neutral, deliverShare });
  const handler = coachApiHandler({
    authenticate: (req) =>
      req.headers.get("authorization") ? Promise.resolve({ userId: user, token: "jwt" }) : Promise.reject(new Error("no")),
    store,
    tools,
    deliverShare,
    mintRealtime: ({ instructions, tools }) =>
      Promise.resolve({ token: `t:${tools.length}:${instructions.includes("CONTEXT")}`, model: "m" }),
    dial,
    departments: () =>
      Promise.resolve([
        {
          department_id: "d1",
          name: "Sales",
          responses: 9,
          suppressed: false,
          engagement: 48,
          prev_engagement: 61,
          sentiment: -0.3,
          score_index: 50,
          attrition_share: 0.33,
          concerns: { growth: 0.67, workload: 0.2 },
        },
      ]),
    recommend: (rows) => Promise.resolve(playbookRecommendations(rows)),
    employeeName: () => Promise.resolve(null),
  }, {});
  const post = async (body: Record<string, unknown>) => {
    const res = await handler(
      new Request("http://x", { method: "POST", headers: { authorization: "Bearer jwt" }, body: JSON.stringify(body) }),
    );
    return { status: res.status, body: await res.json() };
  };
  return { store, post };
}

Deno.test("coach api: live session carries the context and only that mode's tools", async () => {
  const { post, store } = api();
  const coach = await post({ action: "live_session", mode: "coach" });
  assertEquals(coach.body.token, `t:${COACH_TOOLS.length}:true`);
  assert(coach.body.session_id);
  assertEquals((await post({ action: "live_session", mode: "pulse" })).status, 409, "no open check-in");
  assertEquals((await post({ action: "live_tool", mode: "coach", session_id: "s", name: "survey_submit", args: {} })).status, 400);
  const saved = await post({
    action: "live_tool",
    mode: "coach",
    session_id: "s",
    call_id: "c1",
    name: "coach_save_goal",
    args: { title: "Grow" },
  });
  assertMatch(saved.body.result, /Goal saved/);
  assertEquals(store.goals[0].user_id, USER_ID);
});

Deno.test("coach api: decide_share is owner-only and single-use", async () => {
  const { post, store } = api();
  const share = await store.insertShare({
    user_id: MANAGER_ID,
    goal_id: null,
    text: "x",
    recipient_user_id: null,
    recipient_email: null,
    source_call_id: null,
    source_tool_call_id: "a",
  });
  assertEquals((await post({ action: "decide_share", share_id: share.id, approve: true })).status, 404);
  const mine = await store.insertShare({
    user_id: USER_ID,
    goal_id: null,
    text: "y",
    recipient_user_id: MANAGER_ID,
    recipient_email: null,
    source_call_id: null,
    source_tool_call_id: "b",
  });
  assertEquals((await post({ action: "decide_share", share_id: mine.id, approve: true })).body.status, "approved");
  assertEquals(store.shares[1].approved_via, "app");
  assertEquals((await post({ action: "decide_share", share_id: mine.id, approve: false })).status, 409);
});

Deno.test("coach api: demo follow-up calls about the latest open step right away", async () => {
  assertEquals((await api().post({ action: "followup_now" })).status, 409, "no dialer configured");
  const calls: OutboundCall[] = [];
  const store = new FakeCoachStore();
  const { post } = api(store, (c) => {
    calls.push(c);
    return Promise.resolve("id");
  });
  assertEquals((await post({ action: "followup_now" })).status, 409, "no open step");
  await store.insertStep(USER_ID, { text: "Present one idea", due_at: "2099-01-01T00:00:00Z", source_tool_call_id: "s" });
  assertEquals((await post({ action: "followup_now" })).body.status, "calling");
  assertMatch(calls[0].firstMessage, /present one idea/);
  assertEquals(store.steps[0].followup_status, "called");
});

Deno.test("insights: suggestions come from aggregates and skip suppressed groups", async () => {
  const { post } = api();
  const r = await post({ action: "recommendations" });
  assertEquals(r.body.items[0].theme, "growth");
  assertMatch(r.body.items[0].why, /67% of answers raise growth, engagement down 13 points, 33% show attrition signals/);
  assertEquals(
    playbookRecommendations([{
      department_id: "d2",
      name: "Small",
      responses: 3,
      suppressed: true,
      engagement: null,
      prev_engagement: null,
      sentiment: null,
      score_index: null,
      attrition_share: null,
      concerns: null,
    }]),
    [],
  );
});
