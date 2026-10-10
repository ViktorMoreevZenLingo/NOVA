// Service-role data access. Every status change is a conditional UPDATE
// (`... WHERE status IN (allowed) RETURNING`), so duplicate or out-of-order
// events are harmless no-ops.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import type { TaskIntent } from "./contracts.ts";
import type { Layer, RiskLevel, SecurityLevel } from "./policy.ts";

export type TaskStatus =
  | "pending"
  | "submitted"
  | "submit_failed"
  | "completed"
  | "needs_input"
  | "failed"
  | "awaiting_approval"
  /** Approved; the provider call is in flight. Never re-entered automatically. */
  | "sending"
  | "rejected";

export type AgentTask = {
  id: string;
  user_id: string;
  vapi_call_id: string | null;
  vapi_tool_call_id: string | null;
  intent: TaskIntent;
  prompt: string;
  /** email_query, or the action (to/subject/body, title/start/end/…) awaiting approval. */
  params: Record<string, unknown>;
  risk_level: RiskLevel | null;
  layers: Layer[];
  approved_at: string | null;
  approved_via: "call" | "app" | null;
  approval_call_at: string | null;
  approval_call_attempts: number;
  status: TaskStatus;
  manus_task_id: string | null;
  manus_task_url: string | null;
  result: string | null;
  error_message: string | null;
  submit_attempts: number;
  notify_attempts: number;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  notify_claimed_at: string | null;
  notified_at: string | null;
};

/** Caller identity (auth user) plus Alo profile data, if the user filled it in. */
export type Profile = { user_id: string; name: string | null; notes: string | null };

export type CallSession = {
  vapi_call_id: string;
  user_id: string | null;
  pin_failures: number;
  verified_at: string | null;
  /** True for calls Alo itself placed to the registered number (layer L3). */
  via_callback: boolean;
  /** On an inbound call: the callback that was started for it. */
  callback_call_id: string | null;
  purpose: "inbound" | "secure_callback" | "approval";
  /** On a confirmation call: the task being approved. */
  approval_task_id: string | null;
};

export type VoiceSettings = { securityLevel: SecurityLevel; approveByCall: boolean };

export type NewTask =
  & Pick<AgentTask, "user_id" | "vapi_call_id" | "vapi_tool_call_id" | "intent" | "prompt">
  & Partial<Pick<AgentTask, "params" | "risk_level" | "layers" | "status" | "result">>;

export type TaskStore = {
  /** Matches a confirmed auth.users.phone (Alo signs users in by SMS OTP). */
  findProfileByPhone(phone: string): Promise<Profile | null>;
  getProfile(userId: string): Promise<Profile | null>;
  getCallSession(callId: string): Promise<CallSession | null>;
  markCallVerified(callId: string, userId: string): Promise<void>;
  recordPinFailure(callId: string, userId: string): Promise<number>;
  /** PIN failures for this user across all calls in the last hour. */
  recentPinFailures(userId: string): Promise<number>;
  /** The user's floor and approval channel from the Alo app (default standard, by call). */
  getVoiceSettings(userId: string): Promise<VoiceSettings>;
  /** Confirmed registered phone in E.164, for callbacks. */
  userPhone(userId: string): Promise<string | null>;
  /** Reserves the one callback allowed per inbound call; false if already started. */
  claimCallback(inboundCallId: string): Promise<boolean>;
  setCallback(inboundCallId: string, outboundCallId: string | null): Promise<void>;
  /**
   * Session for a call Alo placed to the registered number (L3). A secure callback is
   * verified up front (PIN was given on the inbound call); a confirmation call is not:
   * the PIN must be said on it. Upsert: the user may answer before this runs.
   */
  createCallbackSession(
    outboundCallId: string,
    userId: string,
    opts: { purpose: "secure_callback" | "approval"; approvalTaskId?: string },
  ): Promise<void>;
  /** Takes the right to place a confirmation call for this task (≤3, spaced). */
  claimApprovalCall(taskId: string, minGapMinutes?: number): Promise<AgentTask | null>;
  latestAwaitingApproval(userId: string): Promise<AgentTask | null>;
  awaitingApprovalForCall(callId: string): Promise<AgentTask[]>;

  /** Inserts a task; if this Vapi tool call was already handled, returns the existing row. */
  insertTask(task: NewTask): Promise<{ task: AgentTask; created: boolean }>;
  getTask(id: string): Promise<AgentTask | null>;
  getTaskByManusId(manusTaskId: string): Promise<AgentTask | null>;
  latestTaskForUser(userId: string): Promise<AgentTask | null>;

  /** Conditional transition; returns the updated row or null if `from` didn't match. */
  transition(id: string, from: TaskStatus[], patch: Partial<AgentTask>): Promise<AgentTask | null>;
  markSubmitFailed(id: string, error: string): Promise<number | null>;
  /** Takes a 10-minute send lease; returns the row (with notify_claimed_at) or null. */
  claimNotification(id: string): Promise<AgentTask | null>;
  markNotified(id: string, claimedAt: string): Promise<void>;
  releaseNotification(id: string, claimedAt: string): Promise<void>;

  /** Claims (bumps updated_at) stuck rows and lists rows still owed an email. */
  listForReconcile(olderThanIso: string): Promise<AgentTask[]>;
};

export function createServiceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`DB ${what} failed: ${res.error.message}`);
  return res.data;
}

export function createTaskStore(db: SupabaseClient = createServiceClient()): TaskStore {
  const tasks = () => db.from("agent_tasks");

  async function getProfile(userId: string): Promise<Profile> {
    const row = must(await db.from("profiles").select("name, notes").eq("id", userId).maybeSingle(), "getProfile") as
      | { name: string | null; notes: string | null }
      | null;
    return { user_id: userId, name: row?.name ?? null, notes: row?.notes ?? null };
  }

  return {
    async findProfileByPhone(phone) {
      const userId = must(await db.rpc("nova_user_id_by_phone", { p_phone: phone }), "findProfileByPhone") as string | null;
      return userId ? await getProfile(userId) : null;
    },

    getProfile,

    async getCallSession(callId) {
      return must(await db.from("call_sessions").select("*").eq("vapi_call_id", callId).maybeSingle(), "getCallSession");
    },

    async markCallVerified(callId, userId) {
      must(
        await db.from("call_sessions").upsert({ vapi_call_id: callId, user_id: userId, verified_at: new Date().toISOString() }),
        "markCallVerified",
      );
    },

    async recordPinFailure(callId, userId) {
      return must(await db.rpc("record_pin_failure", { p_call_id: callId, p_user_id: userId }), "recordPinFailure") as number;
    },

    async getVoiceSettings(userId) {
      const row = must(
        await db.from("voice_settings").select("security_level, approve_by_call").eq("user_id", userId).maybeSingle(),
        "getVoiceSettings",
      ) as { security_level: SecurityLevel; approve_by_call: boolean } | null;
      return { securityLevel: row?.security_level ?? "standard", approveByCall: row?.approve_by_call ?? true };
    },

    async userPhone(userId) {
      return must(await db.rpc("nova_user_phone", { p_user_id: userId }), "userPhone") as string | null;
    },

    async claimCallback(inboundCallId) {
      const rows = must(
        await db.from("call_sessions").update({ callback_call_id: "starting" }).eq("vapi_call_id", inboundCallId)
          .is("callback_call_id", null).select("vapi_call_id"),
        "claimCallback",
      ) as unknown[];
      return rows.length === 1;
    },

    async setCallback(inboundCallId, outboundCallId) {
      must(await db.from("call_sessions").update({ callback_call_id: outboundCallId }).eq("vapi_call_id", inboundCallId), "setCallback");
    },

    async createCallbackSession(outboundCallId, userId, opts) {
      must(
        await db.from("call_sessions").upsert({
          vapi_call_id: outboundCallId,
          user_id: userId,
          via_callback: true,
          purpose: opts.purpose,
          approval_task_id: opts.approvalTaskId ?? null,
          ...(opts.purpose === "secure_callback" ? { verified_at: new Date().toISOString() } : {}),
        }),
        "createCallbackSession",
      );
    },

    async claimApprovalCall(taskId, minGapMinutes = 15) {
      const rows = must(
        await db.rpc("nova_claim_approval_call", { p_task_id: taskId, p_min_gap: `${minGapMinutes} minutes` }),
        "claimApprovalCall",
      ) as AgentTask[];
      return rows[0] ?? null;
    },

    async latestAwaitingApproval(userId) {
      return must(
        await tasks().select().eq("user_id", userId).eq("status", "awaiting_approval").order("created_at", { ascending: false })
          .limit(1).maybeSingle(),
        "latestAwaitingApproval",
      ) as AgentTask | null;
    },

    async awaitingApprovalForCall(callId) {
      return must(
        await tasks().select().eq("vapi_call_id", callId).eq("status", "awaiting_approval"),
        "awaitingApprovalForCall",
      ) as AgentTask[];
    },

    async recentPinFailures(userId) {
      return must(await db.rpc("recent_pin_failures", { p_user_id: userId }), "recentPinFailures") as number;
    },

    async insertTask(task) {
      const inserted = await tasks().insert(task).select().maybeSingle();
      if (!inserted.error) return { task: inserted.data as AgentTask, created: true };
      // 23505 = unique_violation on vapi_tool_call_id: Vapi retried the same tool call.
      if (inserted.error.code === "23505" && task.vapi_tool_call_id) {
        const existing = must(await tasks().select().eq("vapi_tool_call_id", task.vapi_tool_call_id).single(), "insertTask(existing)");
        return { task: existing as AgentTask, created: false };
      }
      throw new Error(`DB insertTask failed: ${inserted.error.message}`);
    },

    async getTask(id) {
      return must(await tasks().select().eq("id", id).maybeSingle(), "getTask") as AgentTask | null;
    },

    async getTaskByManusId(manusTaskId) {
      return must(await tasks().select().eq("manus_task_id", manusTaskId).maybeSingle(), "getTaskByManusId") as AgentTask | null;
    },

    async latestTaskForUser(userId) {
      return must(
        await tasks().select().eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        "latestTaskForUser",
      ) as AgentTask | null;
    },

    async transition(id, from, patch) {
      return must(await tasks().update(patch).eq("id", id).in("status", from).select().maybeSingle(), "transition") as AgentTask | null;
    },

    async markSubmitFailed(id, error) {
      return must(await db.rpc("mark_submit_failed", { p_task_id: id, p_error: error }), "markSubmitFailed") as number | null;
    },

    async claimNotification(id) {
      const rows = must(await db.rpc("claim_notification", { p_task_id: id }), "claimNotification") as AgentTask[];
      return rows[0] ?? null;
    },

    async markNotified(id, claimedAt) {
      must(await db.rpc("mark_notified", { p_task_id: id, p_claimed_at: claimedAt }), "markNotified");
    },

    async releaseNotification(id, claimedAt) {
      must(await db.rpc("release_notification", { p_task_id: id, p_claimed_at: claimedAt }), "releaseNotification");
    },

    async listForReconcile(olderThanIso) {
      const stuck = must(await db.rpc("claim_reconcile_batch", { p_older_than: olderThanIso }), "claimReconcileBatch") as AgentTask[];
      const leaseExpired = new Date(Date.now() - 10 * 60_000).toISOString();
      const unnotified = must(
        await tasks().select().in("status", ["completed", "needs_input", "failed"]).is("notified_at", null).lt("notify_attempts", 5)
          .or(`notify_claimed_at.is.null,notify_claimed_at.lt.${leaseExpired}`).limit(50),
        "listForReconcile(unnotified)",
      ) as AgentTask[];
      const seen = new Set(stuck.map((t) => t.id));
      return [...stuck, ...unnotified.filter((t) => !seen.has(t.id))];
    },
  };
}
