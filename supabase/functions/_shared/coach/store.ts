// Service-role data access for NOVA Coach and the employee-voice surveys.
// Status changes are conditional updates (`... where status in (from)`), so retries
// and duplicate tool calls are harmless.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { createServiceClient } from "../db.ts";

export type GoalStatus = "active" | "paused" | "done" | "dropped";
export type StepStatus = "open" | "done" | "partial" | "skipped";
export type NoteKind = "motivation" | "blocker" | "tension" | "insight";
export type ShareStatus = "draft" | "approved" | "sent" | "rejected";
export type FollowupStatus = "none" | "scheduled" | "calling" | "called" | "failed" | "cancelled";

export type Goal = { id: string; user_id: string; title: string; why: string | null; status: GoalStatus; updated_at: string };
export type Note = { id: string; goal_id: string | null; kind: NoteKind; text: string; created_at: string };
export type Step = {
  id: string;
  user_id: string;
  goal_id: string | null;
  text: string;
  due_at: string | null;
  status: StepStatus;
  outcome: string | null;
  reflection: string | null;
  followup_status: FollowupStatus;
  followup_at: string | null;
  followup_attempts: number;
  created_at: string;
};
export type Share = {
  id: string;
  user_id: string;
  goal_id: string | null;
  text: string;
  recipient_user_id: string | null;
  recipient_email: string | null;
  status: ShareStatus;
  approved_via: "call" | "app" | null;
  source_call_id: string | null;
  manager_status: string;
  manager_note: string | null;
  created_at: string;
  sent_at: string | null;
};
export type CoachProfile = {
  user_id: string;
  manager_email: string | null;
  manager_name: string | null;
  call_days: number[];
  call_from: string;
  call_to: string;
  timezone: string;
  followups_enabled: boolean;
  surveys_enabled: boolean;
};
export type Membership = { org_id: string; department_id: string | null; manager_user_id: string | null; role: string };
export type Question = { id: string; type: "scale" | "enps" | "open"; text: string };
export type Campaign = { id: string; org_id: string; kind: "engagement" | "pulse"; title: string; questions: Question[] };
export type Invite = { campaign_id: string; user_id: string; status: string; attempts: number };
export type PublishedAction = { title: string; detail: string | null; status: string; theme: string | null };

export type CoachContext = {
  name: string | null;
  goals: Goal[];
  openSteps: Step[];
  recentSteps: Step[];
  notes: Note[];
  pendingShares: Share[];
  managerReplies: Share[];
  actions: PublishedAction[];
};

/** Everything the analysis produced; the free text itself is never stored. */
export type ResponseRecord = {
  scores: Record<string, number>;
  scoreIndex: number | null;
  enps: number | null;
  sentiment: number | null;
  engagement: number | null;
  concerns: string[];
  strengths: string[];
  attritionSignals: string[];
};

export const DEFAULT_PROFILE: Omit<CoachProfile, "user_id"> = {
  manager_email: null,
  manager_name: null,
  call_days: [1, 2, 3, 4, 5],
  call_from: "09:30",
  call_to: "18:30",
  timezone: "Europe/Sofia",
  followups_enabled: true,
  surveys_enabled: true,
};

export type CoachStore = {
  userIdByPhone(phone: string): Promise<string | null>;
  phoneForUser(userId: string): Promise<string | null>;
  profile(userId: string): Promise<CoachProfile>;
  membership(userId: string): Promise<Membership | null>;
  context(userId: string): Promise<CoachContext>;

  getGoal(userId: string, goalId: string): Promise<Goal | null>;
  insertGoal(userId: string, goal: { title: string; why?: string }): Promise<Goal>;
  updateGoal(userId: string, goalId: string, patch: Partial<Pick<Goal, "title" | "why" | "status">>): Promise<Goal | null>;
  insertNote(userId: string, note: { goal_id?: string | null; kind: NoteKind; text: string }): Promise<void>;

  /** Idempotent per tool call id. */
  insertStep(
    userId: string,
    step: { goal_id?: string | null; text: string; due_at: string; source_tool_call_id: string },
  ): Promise<{ step: Step; created: boolean }>;
  getStep(userId: string, stepId: string): Promise<Step | null>;
  latestOpenStep(userId: string): Promise<Step | null>;
  transitionStep(userId: string, stepId: string, from: StepStatus[], patch: Partial<Step>): Promise<Step | null>;

  /** Idempotent per tool call id. */
  insertShare(
    share: Pick<Share, "user_id" | "goal_id" | "text" | "recipient_user_id" | "recipient_email" | "source_call_id"> & {
      source_tool_call_id: string;
    },
  ): Promise<Share>;
  getShare(shareId: string): Promise<Share | null>;
  latestDraft(userId: string, sourceCallId?: string): Promise<Share | null>;
  transitionShare(shareId: string, from: ShareStatus[], patch: Partial<Share>): Promise<Share | null>;

  openInvite(userId: string): Promise<{ invite: Invite; campaign: Campaign } | null>;
  markInviteCalled(userId: string, campaignId: string): Promise<void>;
  recordResponse(userId: string, campaignId: string, record: ResponseRecord): Promise<boolean>;
  declineInvite(userId: string, campaignId: string): Promise<boolean>;

  claimFollowups(limit: number, userId?: string): Promise<Step[]>;
  finishFollowup(stepId: string, patch: Partial<Step> & { followup_call_id?: string | null }): Promise<void>;
  claimInvites(limit: number): Promise<Invite[]>;
  finishInvite(
    campaignId: string,
    userId: string,
    patch: Partial<Invite> & { call_id?: string | null; next_attempt_at?: string },
  ): Promise<void>;
};

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`DB ${what} failed: ${res.error.message}`);
  return res.data;
}

const STEP_COLUMNS = "id,user_id,goal_id,text,due_at,status,outcome,reflection,followup_status,followup_at,followup_attempts,created_at";

export function createCoachStore(db: SupabaseClient = createServiceClient()): CoachStore {
  const store: CoachStore = {
    async userIdByPhone(phone) {
      return must(await db.rpc("nova_user_id_by_phone", { p_phone: phone }), "userIdByPhone") as string | null;
    },

    async phoneForUser(userId) {
      const row = must(await db.from("account_phones").select("phone").eq("user_id", userId).maybeSingle(), "phoneForUser") as
        | { phone: string }
        | null;
      return row?.phone ?? null;
    },

    async profile(userId) {
      const row = must(await db.from("coach_profiles").select("*").eq("user_id", userId).maybeSingle(), "profile") as
        | CoachProfile
        | null;
      return row ?? { user_id: userId, ...DEFAULT_PROFILE };
    },

    async membership(userId) {
      return must(
        await db.from("org_members").select("org_id,department_id,manager_user_id,role").eq("user_id", userId).maybeSingle(),
        "membership",
      ) as Membership | null;
    },

    async context(userId) {
      const [profile, goals, open, recent, notes, drafts, replies, membership] = await Promise.all([
        db.from("profiles").select("name").eq("id", userId).maybeSingle(),
        db.from("coach_goals").select("id,user_id,title,why,status,updated_at").eq("user_id", userId).in("status", ["active", "paused"])
          .order("updated_at", { ascending: false }).limit(5),
        db.from("coach_steps").select(STEP_COLUMNS).eq("user_id", userId).eq("status", "open").order("created_at", { ascending: false })
          .limit(5),
        db.from("coach_steps").select(STEP_COLUMNS).eq("user_id", userId).neq("status", "open").order("created_at", { ascending: false })
          .limit(3),
        db.from("coach_notes").select("id,goal_id,kind,text,created_at").eq("user_id", userId).order("created_at", { ascending: false })
          .limit(6),
        db.from("coach_shares").select("*").eq("user_id", userId).eq("status", "draft").order("created_at", { ascending: false }).limit(3),
        db.from("coach_shares").select("*").eq("user_id", userId).in("status", ["approved", "sent"]).neq("manager_status", "new")
          .order("updated_at", { ascending: false }).limit(3),
        store.membership(userId),
      ]);
      let actions: PublishedAction[] = [];
      if (membership) {
        const query = db.from("action_items").select("title,detail,status,theme,department_id").eq("org_id", membership.org_id)
          .eq("published", true).order("published_at", { ascending: false }).limit(10);
        const rows = must(await query, "actions") as (PublishedAction & { department_id: string | null })[];
        const mine = await departmentChain(db, membership.department_id);
        actions = rows.filter((a) => a.department_id === null || mine.has(a.department_id)).slice(0, 3)
          .map(({ title, detail, status, theme }) => ({ title, detail, status, theme }));
      }
      return {
        name: (must(profile, "context.profile") as { name: string } | null)?.name ?? null,
        goals: must(goals, "context.goals") as Goal[],
        openSteps: must(open, "context.open") as Step[],
        recentSteps: must(recent, "context.recent") as Step[],
        notes: must(notes, "context.notes") as Note[],
        pendingShares: must(drafts, "context.drafts") as Share[],
        managerReplies: must(replies, "context.replies") as Share[],
        actions,
      };
    },

    async getGoal(userId, goalId) {
      return must(
        await db.from("coach_goals").select("id,user_id,title,why,status,updated_at").eq("user_id", userId).eq("id", goalId).maybeSingle(),
        "getGoal",
      ) as Goal | null;
    },

    async insertGoal(userId, goal) {
      return must(
        await db.from("coach_goals").insert({ user_id: userId, title: goal.title, why: goal.why ?? null })
          .select("id,user_id,title,why,status,updated_at").single(),
        "insertGoal",
      ) as Goal;
    },

    async updateGoal(userId, goalId, patch) {
      return must(
        await db.from("coach_goals").update(patch).eq("user_id", userId).eq("id", goalId).select("id,user_id,title,why,status,updated_at")
          .maybeSingle(),
        "updateGoal",
      ) as Goal | null;
    },

    async insertNote(userId, note) {
      must(await db.from("coach_notes").insert({ user_id: userId, ...note }), "insertNote");
    },

    async insertStep(userId, step) {
      const inserted = await db.from("coach_steps").insert({ user_id: userId, ...step }).select(STEP_COLUMNS).maybeSingle();
      if (!inserted.error) return { step: inserted.data as Step, created: true };
      if (inserted.error.code !== "23505") throw new Error(`DB insertStep failed: ${inserted.error.message}`);
      const existing = must(
        await db.from("coach_steps").select(STEP_COLUMNS).eq("source_tool_call_id", step.source_tool_call_id).eq("user_id", userId)
          .single(),
        "insertStep.existing",
      ) as Step;
      return { step: existing, created: false };
    },

    async getStep(userId, stepId) {
      return must(await db.from("coach_steps").select(STEP_COLUMNS).eq("user_id", userId).eq("id", stepId).maybeSingle(), "getStep") as
        | Step
        | null;
    },

    async latestOpenStep(userId) {
      return must(
        await db.from("coach_steps").select(STEP_COLUMNS).eq("user_id", userId).eq("status", "open").order("created_at", {
          ascending: false,
        })
          .limit(1).maybeSingle(),
        "latestOpenStep",
      ) as Step | null;
    },

    async transitionStep(userId, stepId, from, patch) {
      return must(
        await db.from("coach_steps").update(patch).eq("user_id", userId).eq("id", stepId).in("status", from).select(STEP_COLUMNS)
          .maybeSingle(),
        "transitionStep",
      ) as Step | null;
    },

    async insertShare(share) {
      const inserted = await db.from("coach_shares").insert(share).select("*").maybeSingle();
      if (!inserted.error) return inserted.data as Share;
      if (inserted.error.code !== "23505") throw new Error(`DB insertShare failed: ${inserted.error.message}`);
      return must(
        await db.from("coach_shares").select("*").eq("source_tool_call_id", share.source_tool_call_id).eq("user_id", share.user_id)
          .single(),
        "insertShare.existing",
      ) as Share;
    },

    async getShare(shareId) {
      return must(await db.from("coach_shares").select("*").eq("id", shareId).maybeSingle(), "getShare") as Share | null;
    },

    async latestDraft(userId, sourceCallId) {
      let query = db.from("coach_shares").select("*").eq("user_id", userId).eq("status", "draft");
      if (sourceCallId) query = query.eq("source_call_id", sourceCallId);
      return must(await query.order("created_at", { ascending: false }).limit(1).maybeSingle(), "latestDraft") as Share | null;
    },

    async transitionShare(shareId, from, patch) {
      return must(
        await db.from("coach_shares").update(patch).eq("id", shareId).in("status", from).select("*").maybeSingle(),
        "transitionShare",
      ) as Share | null;
    },

    async openInvite(userId) {
      const rows = must(
        await db.from("survey_invites").select(
          "campaign_id,user_id,status,attempts,survey_campaigns!inner(id,org_id,kind,title,questions,status,ends_at)",
        )
          .eq("user_id", userId).in("status", ["pending", "calling", "called", "failed"]).eq("survey_campaigns.status", "live")
          .order("updated_at", { ascending: false }).limit(5),
        "openInvite",
      ) as unknown as (Invite & { survey_campaigns: Campaign & { ends_at: string | null } })[];
      const now = Date.now();
      const row = rows.find((r) => !r.survey_campaigns.ends_at || Date.parse(r.survey_campaigns.ends_at) > now);
      if (!row) return null;
      const { survey_campaigns: c, ...invite } = row;
      return { invite, campaign: { id: c.id, org_id: c.org_id, kind: c.kind, title: c.title, questions: c.questions } };
    },

    async markInviteCalled(userId, campaignId) {
      must(
        await db.from("survey_invites").update({ status: "called", updated_at: new Date().toISOString() }).eq("user_id", userId)
          .eq("campaign_id", campaignId).in("status", ["pending", "calling", "failed"]),
        "markInviteCalled",
      );
    },

    async recordResponse(userId, campaignId, r) {
      return must(
        await db.rpc("survey_record_response", {
          p_user: userId,
          p_campaign: campaignId,
          p_scores: r.scores,
          p_score_index: r.scoreIndex,
          p_enps: r.enps,
          p_sentiment: r.sentiment,
          p_engagement: r.engagement,
          p_concerns: r.concerns,
          p_strengths: r.strengths,
          p_attrition: r.attritionSignals,
        }),
        "recordResponse",
      ) as boolean;
    },

    async declineInvite(userId, campaignId) {
      const rows = must(
        await db.from("survey_invites").update({ status: "declined", updated_at: new Date().toISOString() }).eq("user_id", userId)
          .eq("campaign_id", campaignId).in("status", ["pending", "calling", "called", "failed"]).select("campaign_id"),
        "declineInvite",
      ) as unknown[];
      return rows.length > 0;
    },

    async claimFollowups(limit, userId) {
      return must(await db.rpc("coach_claim_followups", { p_limit: limit, p_user: userId ?? null }), "claimFollowups") as Step[];
    },

    async finishFollowup(stepId, patch) {
      must(await db.from("coach_steps").update(patch).eq("id", stepId).eq("followup_status", "calling"), "finishFollowup");
    },

    async claimInvites(limit) {
      return must(await db.rpc("survey_claim_invites", { p_limit: limit }), "claimInvites") as Invite[];
    },

    async finishInvite(campaignId, userId, patch) {
      must(
        await db.from("survey_invites").update({ ...patch, updated_at: new Date().toISOString() }).eq("campaign_id", campaignId)
          .eq("user_id", userId).eq("status", "calling"),
        "finishInvite",
      );
    },
  };
  return store;
}

async function departmentChain(db: SupabaseClient, departmentId: string | null): Promise<Set<string>> {
  const chain = new Set<string>();
  let current = departmentId;
  while (current && !chain.has(current) && chain.size < 20) {
    chain.add(current);
    const row = must(await db.from("departments").select("parent_id").eq("id", current).maybeSingle(), "departmentChain") as
      | { parent_id: string | null }
      | null;
    current = row?.parent_id ?? null;
  }
  return chain;
}
