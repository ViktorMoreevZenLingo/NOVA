// In-memory CoachStore mirroring the SQL semantics that matter to the handlers:
// conditional transitions, idempotent inserts, the follow-up trigger and single-answer surveys.
import type {
  Campaign,
  CoachContext,
  CoachProfile,
  CoachStore,
  Goal,
  Invite,
  Membership,
  ResponseRecord,
  Share,
  Step,
} from "../../supabase/functions/_shared/coach/store.ts";
import { DEFAULT_PROFILE } from "../../supabase/functions/_shared/coach/store.ts";
import { USER_ID, USER_PHONE } from "./fakes.ts";

export const MANAGER_ID = "00000000-0000-4000-8000-0000000000aa";
export const CAMPAIGN: Campaign = {
  id: "00000000-0000-4000-8000-0000000000c1",
  org_id: "00000000-0000-4000-8000-0000000000f1",
  kind: "pulse",
  title: "Weekly pulse",
  questions: [
    { id: "week", type: "scale", text: "From 1 to 5, how was your work week?" },
    { id: "enps", type: "enps", text: "0 to 10, recommend working here?" },
    { id: "better", type: "open", text: "What got in your way?" },
  ],
};

let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export class FakeCoachStore implements CoachStore {
  phones = new Map<string, string>([[USER_PHONE, USER_ID]]);
  profiles = new Map<string, CoachProfile>();
  memberships = new Map<string, Membership>([[USER_ID, {
    org_id: CAMPAIGN.org_id,
    department_id: "d1",
    manager_user_id: MANAGER_ID,
    role: "employee",
  }]]);
  goals: Goal[] = [];
  notes: { user_id: string; kind: string; text: string; goal_id?: string | null }[] = [];
  steps: (Step & { source_tool_call_id?: string; followup_call_id?: string | null })[] = [];
  shares: (Share & { source_tool_call_id: string })[] = [];
  invites: Invite[] = [];
  campaigns: Campaign[] = [CAMPAIGN];
  responses: { campaign_id: string; record: ResponseRecord }[] = [];
  actions = [{ title: "Project rotation in Sales", detail: null, status: "in_progress", theme: "growth" }];

  userIdByPhone(phone: string) {
    return Promise.resolve(this.phones.get(phone) ?? null);
  }
  phoneForUser(userId: string) {
    return Promise.resolve([...this.phones].find(([, id]) => id === userId)?.[0] ?? null);
  }
  profile(userId: string) {
    return Promise.resolve(this.profiles.get(userId) ?? { user_id: userId, ...DEFAULT_PROFILE });
  }
  membership(userId: string) {
    return Promise.resolve(this.memberships.get(userId) ?? null);
  }
  context(userId: string): Promise<CoachContext> {
    return Promise.resolve({
      name: "Maria",
      goals: this.goals.filter((g) => g.user_id === userId),
      openSteps: this.steps.filter((s) => s.user_id === userId && s.status === "open"),
      recentSteps: this.steps.filter((s) => s.user_id === userId && s.status !== "open"),
      notes: [],
      pendingShares: this.shares.filter((s) => s.user_id === userId && s.status === "draft"),
      managerReplies: [],
      actions: this.memberships.has(userId) ? this.actions : [],
    });
  }
  getGoal(userId: string, goalId: string) {
    return Promise.resolve(this.goals.find((g) => g.user_id === userId && g.id === goalId) ?? null);
  }
  insertGoal(userId: string, goal: { title: string; why?: string }) {
    const g: Goal = {
      id: uid(),
      user_id: userId,
      title: goal.title,
      why: goal.why ?? null,
      status: "active",
      updated_at: new Date().toISOString(),
    };
    this.goals.push(g);
    return Promise.resolve(g);
  }
  updateGoal(userId: string, goalId: string, patch: Partial<Goal>) {
    const g = this.goals.find((x) => x.user_id === userId && x.id === goalId);
    if (g) Object.assign(g, patch);
    return Promise.resolve(g ?? null);
  }
  insertNote(userId: string, note: { goal_id?: string | null; kind: string; text: string }) {
    this.notes.push({ user_id: userId, ...note });
    return Promise.resolve();
  }
  insertStep(userId: string, step: { goal_id?: string | null; text: string; due_at: string; source_tool_call_id: string }) {
    const existing = this.steps.find((s) => s.source_tool_call_id === step.source_tool_call_id);
    if (existing) return Promise.resolve({ step: existing, created: false });
    const s = {
      id: uid(),
      user_id: userId,
      goal_id: step.goal_id ?? null,
      text: step.text,
      due_at: step.due_at,
      status: "open" as const,
      outcome: null,
      reflection: null,
      followup_status: "scheduled" as const,
      followup_at: step.due_at,
      followup_attempts: 0,
      created_at: new Date().toISOString(),
      source_tool_call_id: step.source_tool_call_id,
    };
    this.steps.push(s);
    return Promise.resolve({ step: s, created: true });
  }
  getStep(userId: string, stepId: string) {
    return Promise.resolve(this.steps.find((s) => s.user_id === userId && s.id === stepId) ?? null);
  }
  latestOpenStep(userId: string) {
    return Promise.resolve(this.steps.filter((s) => s.user_id === userId && s.status === "open").at(-1) ?? null);
  }
  transitionStep(userId: string, stepId: string, from: Step["status"][], patch: Partial<Step>) {
    const s = this.steps.find((x) => x.user_id === userId && x.id === stepId && from.includes(x.status));
    if (!s) return Promise.resolve(null);
    const dueChanged = patch.due_at !== undefined && patch.due_at !== s.due_at;
    Object.assign(s, patch);
    // Mirrors the coach_steps_schedule trigger.
    if (s.status === "open" && dueChanged) Object.assign(s, { followup_status: "scheduled", followup_at: s.due_at, followup_attempts: 0 });
    if (s.status !== "open" && s.followup_status === "scheduled") s.followup_status = "cancelled";
    return Promise.resolve(s);
  }
  insertShare(
    share: Pick<Share, "user_id" | "goal_id" | "text" | "recipient_user_id" | "recipient_email" | "source_call_id"> & {
      source_tool_call_id: string;
    },
  ) {
    const existing = this.shares.find((s) => s.source_tool_call_id === share.source_tool_call_id);
    if (existing) return Promise.resolve(existing);
    const s = {
      ...share,
      id: uid(),
      status: "draft" as const,
      approved_via: null,
      manager_status: "new",
      manager_note: null,
      created_at: new Date(Date.now() + seq).toISOString(),
      sent_at: null,
    };
    this.shares.push(s);
    return Promise.resolve(s);
  }
  getShare(shareId: string) {
    return Promise.resolve(this.shares.find((s) => s.id === shareId) ?? null);
  }
  latestDraft(userId: string, sourceCallId?: string) {
    return Promise.resolve(
      this.shares.filter((s) => s.user_id === userId && s.status === "draft" && (!sourceCallId || s.source_call_id === sourceCallId)).at(
        -1,
      ) ??
        null,
    );
  }
  transitionShare(shareId: string, from: Share["status"][], patch: Partial<Share>) {
    const s = this.shares.find((x) => x.id === shareId && from.includes(x.status));
    if (s) Object.assign(s, patch);
    return Promise.resolve(s ?? null);
  }
  openInvite(userId: string) {
    const invite = this.invites.find((i) => i.user_id === userId && ["pending", "calling", "called", "failed"].includes(i.status));
    const campaign = invite && this.campaigns.find((c) => c.id === invite.campaign_id);
    return Promise.resolve(invite && campaign ? { invite, campaign } : null);
  }
  markInviteCalled(userId: string, campaignId: string) {
    const i = this.invites.find((x) => x.user_id === userId && x.campaign_id === campaignId);
    if (i && ["pending", "calling", "failed"].includes(i.status)) i.status = "called";
    return Promise.resolve();
  }
  recordResponse(userId: string, campaignId: string, record: ResponseRecord) {
    const i = this.invites.find((x) =>
      x.user_id === userId && x.campaign_id === campaignId && x.status !== "answered" && x.status !== "declined"
    );
    if (!i) return Promise.resolve(false);
    i.status = "answered";
    this.responses.push({ campaign_id: campaignId, record });
    return Promise.resolve(true);
  }
  declineInvite(userId: string, campaignId: string) {
    const i = this.invites.find((x) => x.user_id === userId && x.campaign_id === campaignId && x.status !== "answered");
    if (i) i.status = "declined";
    return Promise.resolve(!!i);
  }
  claimFollowups(limit: number, userId?: string) {
    const now = Date.now();
    const due = this.steps.filter((s) =>
      s.status === "open" && s.followup_status === "scheduled" && Date.parse(s.followup_at!) <= now && (!userId || s.user_id === userId)
    ).slice(0, limit);
    for (const s of due) Object.assign(s, { followup_status: "calling", followup_attempts: s.followup_attempts + 1 });
    return Promise.resolve(due.map((s) => ({ ...s })));
  }
  finishFollowup(stepId: string, patch: Partial<Step> & { followup_call_id?: string | null }) {
    const s = this.steps.find((x) => x.id === stepId && x.followup_status === "calling");
    if (s) Object.assign(s, patch);
    return Promise.resolve();
  }
  claimInvites(limit: number) {
    const due = this.invites.filter((i) => i.status === "pending").slice(0, limit);
    for (const i of due) Object.assign(i, { status: "calling", attempts: i.attempts + 1 });
    return Promise.resolve(due.map((i) => ({ ...i })));
  }
  finishInvite(campaignId: string, userId: string, patch: Partial<Invite>) {
    const i = this.invites.find((x) => x.campaign_id === campaignId && x.user_id === userId && x.status === "calling");
    if (i) Object.assign(i, patch);
    return Promise.resolve();
  }
}
