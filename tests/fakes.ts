// In-memory fakes for the DB, Manus and email layers. They mirror the
// conditional-update semantics of the real SQL (see migrations/*_init.sql).
import type { TaskResult } from "../supabase/functions/_shared/contracts.ts";
import type { AgentTask, CallSession, NewTask, Profile, TaskStore } from "../supabase/functions/_shared/db.ts";
import type { ManusClient, ManusTask } from "../supabase/functions/_shared/manus.ts";
import type { TaskDeps } from "../supabase/functions/_shared/tasks.ts";

export const USER_ID = "00000000-0000-4000-8000-000000000001";
export const USER_PHONE = "+15550001111";
export const USER_EMAIL = "demo@example.com";
export const PIN = "123456";
export const VAPI_SECRET = "vapi-secret";

export class FakeStore implements TaskStore {
  profiles: Profile[] = [{ user_id: USER_ID, notify_email: USER_EMAIL }];
  phones = new Map<string, string>([[USER_PHONE, USER_ID]]);
  sessions = new Map<string, CallSession>();
  tasks: AgentTask[] = [];
  private seq = 0;

  findProfileByPhone(phone: string) {
    const id = this.phones.get(phone);
    return Promise.resolve(this.profiles.find((p) => p.user_id === id) ?? null);
  }
  getProfile(userId: string) {
    return Promise.resolve(this.profiles.find((p) => p.user_id === userId) ?? null);
  }
  getCallSession(callId: string) {
    return Promise.resolve(this.sessions.get(callId) ?? null);
  }
  markCallVerified(callId: string, userId: string) {
    const s = this.sessions.get(callId) ?? { vapi_call_id: callId, user_id: null, pin_failures: 0, verified_at: null };
    this.sessions.set(callId, { ...s, user_id: userId, verified_at: new Date().toISOString() });
    return Promise.resolve();
  }
  recordPinFailure(callId: string, userId: string) {
    const s = this.sessions.get(callId) ?? { vapi_call_id: callId, user_id: userId, pin_failures: 0, verified_at: null };
    s.pin_failures += 1;
    this.sessions.set(callId, s);
    return Promise.resolve(s.pin_failures);
  }
  recentPinFailures(userId: string) {
    let total = 0;
    for (const s of this.sessions.values()) if (s.user_id === userId) total += s.pin_failures;
    return Promise.resolve(total);
  }

  insertTask(t: NewTask) {
    const existing = t.vapi_tool_call_id && this.tasks.find((x) => x.vapi_tool_call_id === t.vapi_tool_call_id);
    if (existing) return Promise.resolve({ task: { ...existing }, created: false });
    const now = new Date().toISOString();
    const task: AgentTask = {
      ...t,
      id: `00000000-0000-4000-9000-${String(++this.seq).padStart(12, "0")}`,
      status: "pending",
      manus_task_id: null,
      manus_task_url: null,
      result: null,
      error_message: null,
      submit_attempts: 0,
      notify_attempts: 0,
      last_event_at: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
      notify_claimed_at: null,
      notified_at: null,
    };
    this.tasks.push(task);
    return Promise.resolve({ task: { ...task }, created: true });
  }
  getTask(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    return Promise.resolve(t ? { ...t } : null);
  }
  getTaskByManusId(id: string) {
    const t = this.tasks.find((x) => x.manus_task_id === id);
    return Promise.resolve(t ? { ...t } : null);
  }
  latestTaskForUser(userId: string) {
    const t = this.tasks.filter((x) => x.user_id === userId).at(-1);
    return Promise.resolve(t ? { ...t } : null);
  }
  transition(id: string, from: AgentTask["status"][], patch: Partial<AgentTask>) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t || !from.includes(t.status)) return Promise.resolve(null);
    Object.assign(t, patch, { updated_at: new Date().toISOString() });
    return Promise.resolve({ ...t });
  }
  markSubmitFailed(id: string, error: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t || !["pending", "submit_failed"].includes(t.status)) return Promise.resolve(null);
    Object.assign(t, { status: "submit_failed", submit_attempts: t.submit_attempts + 1, error_message: error });
    return Promise.resolve(t.submit_attempts);
  }
  private leaseFree(t: AgentTask) {
    return !t.notify_claimed_at || Date.parse(t.notify_claimed_at) < Date.now() - 10 * 60_000;
  }
  private claimSeq = 0;
  claimNotification(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (
      !t || t.notified_at || !this.leaseFree(t) || !["completed", "needs_input", "failed"].includes(t.status) ||
      t.notify_attempts >= 5
    ) {
      return Promise.resolve(null);
    }
    // Unique lease value per claim (real DB uses now() with microseconds).
    t.notify_claimed_at = new Date(Date.now() + ++this.claimSeq).toISOString();
    return Promise.resolve({ ...t });
  }
  markNotified(id: string, claimedAt: string) {
    const t = this.tasks.find((x) => x.id === id)!;
    if (t.notify_claimed_at === claimedAt) Object.assign(t, { notified_at: new Date().toISOString(), notify_claimed_at: null });
    return Promise.resolve();
  }
  releaseNotification(id: string, claimedAt: string) {
    const t = this.tasks.find((x) => x.id === id)!;
    if (t.notify_claimed_at === claimedAt) Object.assign(t, { notify_claimed_at: null, notify_attempts: t.notify_attempts + 1 });
    return Promise.resolve();
  }
  listForReconcile(_olderThanIso: string) {
    // Fake ignores age so tests don't need to wait.
    return Promise.resolve(
      this.tasks
        .filter((t) =>
          ["pending", "submitted", "submit_failed", "needs_input"].includes(t.status) ||
          (["completed", "needs_input", "failed"].includes(t.status) && !t.notified_at && t.notify_attempts < 5 && this.leaseFree(t))
        )
        .map((t) => ({ ...t })),
    );
  }

  only(): AgentTask {
    if (this.tasks.length !== 1) throw new Error(`expected 1 task, got ${this.tasks.length}`);
    return this.tasks[0];
  }
}

export class FakeManus implements ManusClient {
  created: { content: string; connectors: string[]; title: string }[] = [];
  failCreate = false;
  detail: ManusTask = { id: "manus-1", status: "running", has_running_background_jobs: false };
  assistantMessage: string | null = "Final answer from Manus";
  errorMessage: string | null = null;
  pem = "";
  /** Simulates key rotation: the cached key is stale until refresh is requested. */
  stalePem: string | null = null;
  keyFetches = 0;

  createTask(input: { content: string; connectors: string[] }, title: string) {
    if (this.failCreate) return Promise.reject(new Error("Manus task.create failed: 503"));
    this.created.push({ ...input, title });
    const taskId = `manus-${this.created.length}`;
    return Promise.resolve({ taskId, taskUrl: `https://manus.im/app/${taskId}` });
  }
  getTask(taskId: string) {
    return Promise.resolve({ ...this.detail, id: taskId });
  }
  latestAssistantMessage(_taskId: string) {
    return Promise.resolve(this.assistantMessage);
  }
  latestError(_taskId: string) {
    return Promise.resolve(this.errorMessage);
  }
  publicKeyPem(refresh = false) {
    if (refresh) {
      this.keyFetches++;
      this.stalePem = null;
    }
    return Promise.resolve(this.stalePem ?? this.pem);
  }
}

export class FakeEmail {
  sent: { recipient: string; result: TaskResult }[] = [];
  fail = false;
  send = (recipient: string, result: TaskResult) => {
    if (this.fail) return Promise.reject(new Error("resend down"));
    this.sent.push({ recipient, result });
    return Promise.resolve();
  };
}

export function makeDeps() {
  const store = new FakeStore();
  const manus = new FakeManus();
  const email = new FakeEmail();
  const deps: TaskDeps = {
    store,
    manus,
    buildGmailPrompt: (instruction) => Promise.resolve({ content: `GMAIL: ${instruction}`, connectors: ["gmail-connector"] }),
    sendResultEmail: email.send,
  };
  return { store, manus, email, deps };
}

export function vapiRequest(
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[],
  opts: { callId?: string; number?: string | null; secret?: string; callType?: string } = {},
): Request {
  const number = opts.number === undefined ? USER_PHONE : opts.number;
  const body = {
    message: {
      type: "tool-calls",
      toolCallList: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: { name: tc.name, arguments: tc.args } })),
      call: { id: opts.callId ?? "call-1", type: opts.callType ?? "inboundPhoneCall", customer: number ? { number } : undefined },
    },
  };
  return new Request("http://localhost/create-task", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.secret ?? VAPI_SECRET}` },
    body: JSON.stringify(body),
  });
}

/** RSA key pair + signer that reproduces Manus' webhook signing scheme. */
export async function makeSigner() {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", publicKey));
  const b64 = btoa(String.fromCharCode(...spki));
  const pem = `-----BEGIN PUBLIC KEY-----\n${b64.match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----`;

  async function sign(url: string, body: string, timestamp: number): Promise<string> {
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${timestamp}.${url}.${hash}`));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }

  return { pem, sign };
}
