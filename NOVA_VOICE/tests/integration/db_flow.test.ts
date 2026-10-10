// Runs the real handlers against the local Supabase DB (real TaskStore, real SQL
// helpers, real RLS) with fake Manus + email. Requires `supabase start`.
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<from `supabase status`> deno task test:integration
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createTaskHandler } from "../../../supabase/functions/create-task/handler.ts";
import { manusWebhookHandler } from "../../../supabase/functions/manus-webhook/handler.ts";
import { reconcileHandler } from "../../../supabase/functions/reconcile/handler.ts";
import { createTaskStore } from "../../../supabase/functions/_shared/db.ts";
import type { TaskDeps } from "../../../supabase/functions/_shared/tasks.ts";
import { FakeEmail, FakeManus, makeSigner, PIN, VAPI_SECRET, vapiRequest } from "../fakes.ts";

const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const WEBHOOK_URL = "https://example.supabase.co/functions/v1/manus-webhook";

Deno.test({
  name: "integration: call → task → webhook → email, against real Postgres",
  ignore: !url || !key,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const admin = createClient(url!, key!, { auth: { persistSession: false } });
    // Alo users sign up by SMS OTP: a confirmed phone, no email.
    const phone = `+359${Math.floor(800_000_000 + Math.random() * 99_999_999)}`;
    const { data: created, error } = await admin.auth.admin.createUser({ phone, phone_confirm: true });
    if (error) throw error;
    const userId = created.user.id;

    try {
      const { error: profileErr } = await admin.from("profiles").insert({ id: userId, name: "Integration", notes: "Likes bullet points." });
      if (profileErr) throw profileErr;

      const manus = new FakeManus();
      const mail = new FakeEmail();
      const signer = await makeSigner();
      manus.pem = signer.pem;
      // Unique Manus ids so reruns don't collide on the unique index.
      const prefix = crypto.randomUUID();
      const origCreate = manus.createTask.bind(manus);
      manus.createTask = async (input, title) => {
        const r = await origCreate(input, title);
        return { ...r, taskId: `${prefix}-${r.taskId}` };
      };

      const deps: TaskDeps = {
        store: createTaskStore(admin),
        manus,
        buildGmailPrompt: (i) => Promise.resolve({ content: i, connectors: ["gmail"] }),
        sendResultEmail: mail.send,
      };
      const callId = `it-call-${prefix}`;
      const createTask = createTaskHandler(deps, { vapiSecret: VAPI_SECRET, caller: { pin: PIN } });

      // Wrong PIN is counted in call_sessions.
      let res = await createTask(
        vapiRequest([{ id: `${prefix}-tc0`, name: "create_task", args: { intent: "research", instruction: "x", pin: "000000" } }], {
          callId,
          number: phone,
        }),
      );
      assertMatch((await res.json()).results[0].error, /incorrect/);

      const toolCall = {
        id: `${prefix}-tc1`,
        name: "create_task",
        args: { intent: "summarize_emails", instruction: "Summarize my inbox", pin: PIN },
      };
      res = await createTask(vapiRequest([toolCall], { callId, number: phone }));
      assertMatch((await res.json()).results[0].result, /Task accepted/);
      // Vapi retry of the same tool call → no duplicate.
      await createTask(vapiRequest([toolCall], { callId, number: phone }));

      const { data: rows } = await admin.from("agent_tasks").select().eq("user_id", userId);
      assertEquals(rows!.length, 1);
      const task = rows![0];
      assertEquals(task.status, "submitted");
      assertMatch(manus.created[0].content, /Likes bullet points/);

      // Mirrored into the Alo app's History.
      const { data: act1 } = await admin.from("activity").select().eq("id", task.id).single();
      assertEquals(act1.type, "task");
      assertEquals(act1.status, "in_progress");
      assertEquals(manus.created.length, 1);

      // Signed webhook, delivered twice.
      const webhook = manusWebhookHandler(deps, { webhookUrl: WEBHOOK_URL });
      const body = JSON.stringify({
        event_id: `task_stopped_${task.manus_task_id}`,
        event_type: "task_stopped",
        task_detail: {
          task_id: task.manus_task_id,
          task_url: "https://manus.im/app/x",
          message: "3 important emails",
          stop_reason: "finish",
        },
      });
      for (let i = 0; i < 2; i++) {
        const ts = Math.floor(Date.now() / 1000);
        const sig = await signer.sign(WEBHOOK_URL, body, ts);
        const r = await webhook(
          new Request("http://x", { method: "POST", headers: { "x-webhook-signature": sig, "x-webhook-timestamp": String(ts) }, body }),
        );
        assertEquals(r.status, 200);
      }

      const { data: done } = await admin.from("agent_tasks").select().eq("id", task.id).single();
      assertEquals(done.status, "completed");
      assertEquals(done.result, "3 important emails");
      assert(done.notified_at);
      assert(done.completed_at);
      assertEquals(mail.sent.length, 1);
      assertEquals(mail.sent[0].userId, userId);
      const { data: act2 } = await admin.from("activity").select().eq("id", task.id).single();
      assertEquals(act2.status, "done");
      assertEquals(act2.detail.en, "3 important emails");

      // Reconcile finds nothing left to do for this task.
      const reconcile = reconcileHandler(deps, { cronSecret: "c", staleAfterMs: 0 });
      await reconcile(new Request("http://x", { method: "POST", headers: { authorization: "Bearer c" } }));
      assertEquals(mail.sent.length, 1);

      // Email failure path with the real SQL claim/release.
      const { data: t2 } = await admin.from("agent_tasks").insert({
        user_id: userId,
        intent: "research",
        prompt: "y",
        status: "completed",
        result: "r",
      }).select().single();
      mail.fail = true;
      await reconcile(new Request("http://x", { method: "POST", headers: { authorization: "Bearer c" } }));
      const { data: t2after } = await admin.from("agent_tasks").select().eq("id", t2.id).single();
      assertEquals(t2after.notified_at, null);
      assertEquals(t2after.notify_attempts, 1);
      mail.fail = false;
      await reconcile(new Request("http://x", { method: "POST", headers: { authorization: "Bearer c" } }));
      assertEquals(mail.sent.length, 2);
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  },
});
