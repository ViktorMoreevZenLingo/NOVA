// Real CoachStore + coach tools against the local Supabase stack (PostgREST, RLS, RPCs).
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... deno task test:integration
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createCoachStore } from "../../../supabase/functions/_shared/coach/store.ts";
import { coachTools } from "../../../supabase/functions/_shared/coach/service.ts";
import { keywordClassifier } from "../../../supabase/functions/_shared/coach/analysis.ts";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const anon = Deno.env.get("SUPABASE_ANON_KEY");

async function person(admin: SupabaseClient, label: string) {
  const email = `coach-it-${label}-${crypto.randomUUID().slice(0, 8)}@example.invalid`;
  const password = crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url!, anon!, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { id: data.user.id, client };
}

Deno.test({
  name: "integration: coach tools, consent sharing, anonymous pulse and k>=5 insights on real Postgres",
  ignore: !url || !key || !anon,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const admin = createClient(url!, key!, { auth: { persistSession: false } });
    const [employee, manager, hr, ...others] = await Promise.all(
      ["employee", "manager", "hr", "a", "b", "c", "d"].map((l) => person(admin, l)),
    );
    const { data: org } = await admin.from("orgs").insert({ name: "IT org" }).select("id").single();
    const { data: dept } = await admin.from("departments").insert({ org_id: org!.id, name: "Sales" }).select("id").single();
    try {
      await admin.from("org_members").insert([
        // Bulk inserts send every key, so each row spells out all columns.
        { user_id: employee.id, org_id: org!.id, department_id: dept!.id, manager_user_id: manager.id, role: "employee" },
        { user_id: manager.id, org_id: org!.id, department_id: dept!.id, manager_user_id: null, role: "manager" },
        { user_id: hr.id, org_id: org!.id, department_id: null, manager_user_id: null, role: "hr" },
        ...others.map((o) => ({ user_id: o.id, org_id: org!.id, department_id: dept!.id, manager_user_id: manager.id, role: "employee" })),
      ]).throwOnError();

      const store = createCoachStore(admin);
      const tools = coachTools({
        store,
        classify: (t) => Promise.resolve(keywordClassifier(t)),
        deliverShare: () => Promise.resolve("in_app"),
      });
      const ctx = (toolCallId: string) => ({ userId: employee.id, toolCallId, sessionId: "it-call", via: "call" as const });

      assertMatch(await tools.coach_recall(ctx("r1"), {}), /first conversation/);
      const goal = await tools.coach_save_goal(ctx("g1"), { title: "Take on more responsibility" });
      const goalId = goal.match(/goal:([0-9a-f-]{36})/)![1];
      assertMatch(
        await tools.coach_commit_step(ctx("s1"), { text: "Prepare one proposal", due_in_days: 7, goal_id: goalId }),
        /Step saved/,
      );
      await tools.coach_commit_step(ctx("s1"), { text: "Prepare one proposal", due_in_days: 7 });
      assertMatch(await tools.coach_propose_share(ctx("p1"), { text: "I would like to take on a small project" }), /NOT sent/);

      // Before approval the manager sees nothing.
      assertEquals((await manager.client.rpc("coach_team_requests")).data?.length, 0);
      assertMatch(await tools.coach_decide_share(ctx("d1"), { approve: true }), /Approved/);
      const { data: requests } = await manager.client.rpc("coach_team_requests");
      assertEquals(requests?.map((r: { text: string }) => r.text), ["I would like to take on a small project"]);

      // The employee's own data: visible to them, invisible to the manager and HR; follow-up columns are server-only.
      const { data: mySteps } = await employee.client.from("coach_steps").select("text, followup_status");
      assertEquals(mySteps, [{ text: "Prepare one proposal", followup_status: "scheduled" }]);
      assertEquals((await manager.client.from("coach_steps").select("id")).data, []);
      assertEquals((await hr.client.from("coach_goals").select("id")).data, []);
      const forged = await employee.client.from("coach_steps").update({ followup_status: "none" }).eq("user_id", employee.id);
      assert(forged.error, "browser cannot touch follow-up state");

      // Pulse: HR launches, the employee answers through the tools, the browser never reads responses.
      const { data: campaignId, error: launchError } = await hr.client.rpc("insights_launch_campaign", {
        p_kind: "pulse",
        p_title: "IT pulse",
      });
      if (launchError) throw launchError;
      assertMatch(await tools.survey_get_questions(ctx("q1"), {}), /\[week\]/);
      assertMatch(
        await tools.survey_submit(ctx("q2"), { answers: [{ question_id: "week", score: 2, text: "Same tasks every week, no growth" }] }),
        /anonymously/,
      );
      assert((await employee.client.from("survey_responses").select("id")).error, "responses are not readable from the browser");
      const { data: invite } = await employee.client.from("survey_invites").select("status").eq("campaign_id", campaignId).single();
      assertEquals(invite!.status, "answered");

      const insight = async () =>
        ((await manager.client.rpc("insights_departments")).data as {
          department_id: string | null;
          suppressed: boolean;
          concerns: Record<string, number>;
        }[])
          .find((d) => d.department_id === dept!.id)!;
      assertEquals((await insight()).suppressed, true, "1 answer is not enough");
      for (const o of others) {
        await store.recordResponse(o.id, campaignId, {
          scores: { week: 3 },
          scoreIndex: 50,
          enps: null,
          sentiment: 0,
          engagement: 50,
          concerns: ["growth"],
          strengths: [],
          attritionSignals: [],
        });
      }
      const visible = await insight();
      assertEquals(visible.suppressed, false, "5 answers are shown");
      assertEquals(visible.concerns.growth, 1);
    } finally {
      await admin.from("orgs").delete().eq("id", org!.id);
      for (const p of [employee, manager, hr, ...others]) await admin.auth.admin.deleteUser(p.id);
    }
  },
});
