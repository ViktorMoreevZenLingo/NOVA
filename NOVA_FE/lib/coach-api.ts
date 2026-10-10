import { getSupabase, invoke } from "./supabase";

// NOVA Coach + employee voice. Personal data is read with the user's own session (RLS:
// owner only). Managers, leadership and HR only ever get aggregates from insights_* RPCs,
// which return numbers for groups of at least 5 answers.

export type Role = "employee" | "manager" | "leader" | "hr";
export interface Membership {
  org_id: string;
  org_name: string;
  department_id: string | null;
  department_name: string | null;
  role: Role;
  manager_name: string | null;
  display_name: string | null;
}
export interface Goal {
  id: string;
  title: string;
  why: string | null;
  status: "active" | "paused" | "done" | "dropped";
  created_at: string;
}
export interface Step {
  id: string;
  goal_id: string | null;
  text: string;
  due_at: string | null;
  status: "open" | "done" | "partial" | "skipped";
  outcome: string | null;
  reflection: string | null;
  followup_status: string;
  followup_at: string | null;
  created_at: string;
}
export interface Note {
  id: string;
  goal_id: string | null;
  kind: "motivation" | "blocker" | "tension" | "insight";
  text: string;
  created_at: string;
}
export interface Share {
  id: string;
  user_id: string;
  text: string;
  status: "draft" | "approved" | "sent" | "rejected";
  recipient_user_id: string | null;
  recipient_email: string | null;
  manager_status: "new" | "acknowledged" | "planned" | "done";
  manager_note: string | null;
  created_at: string;
  decided_at: string | null;
}
export interface CoachProfile {
  manager_email: string | null;
  manager_name: string | null;
  call_days: number[];
  call_from: string;
  call_to: string;
  timezone: string;
  followups_enabled: boolean;
  surveys_enabled: boolean;
}
export interface Invite {
  campaign_id: string;
  status: string;
  updated_at: string;
  survey_campaigns: { title: string; kind: string; status: string; ends_at: string | null; starts_at: string } | null;
}
export interface ActionItem {
  id: string;
  department_id: string | null;
  campaign_id: string | null;
  theme: string | null;
  title: string;
  detail: string | null;
  status: "planned" | "in_progress" | "done";
  published: boolean;
  published_at: string | null;
  created_at: string;
}
export interface DepartmentInsight {
  department_id: string | null;
  name: string;
  parent_id: string | null;
  members: number;
  responses: number;
  suppressed: boolean;
  engagement: number | null;
  score_index: number | null;
  sentiment: number | null;
  enps: number | null;
  attrition_share: number | null;
  prev_engagement: number | null;
  response_rate: number | null;
  concerns: Record<string, number> | null;
  strengths: Record<string, number> | null;
}
export interface TrendPoint {
  week: string;
  responses: number;
  suppressed: boolean;
  engagement: number | null;
  score_index: number | null;
  sentiment: number | null;
  attrition_share: number | null;
}
export interface ActionImpact {
  action_id: string;
  before_responses: number;
  after_responses: number;
  before_engagement: number | null;
  after_engagement: number | null;
  before_theme_share: number | null;
  after_theme_share: number | null;
}
export interface Campaign {
  id: string;
  kind: "engagement" | "pulse";
  title: string;
  status: "draft" | "live" | "closed";
  starts_at: string;
  ends_at: string | null;
  department_ids: string[];
}
export interface Recommendation {
  department_id: string | null;
  department: string;
  theme: string;
  title: string;
  detail: string;
  why: string;
}

export const THEME_LABELS: Record<string, string> = {
  workload: "Workload",
  growth: "Growth",
  recognition: "Recognition",
  manager_support: "Manager support",
  team: "Team",
  clarity: "Clarity",
  pay: "Pay",
  wellbeing: "Wellbeing",
  tools: "Tools & process",
  other: "Other",
};
export const themeLabel = (t: string | null | undefined) => (t ? THEME_LABELS[t] ?? t : "");

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function rows<T>(res: { data: T[] | null; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(res.error.message);
  return res.data ?? [];
}

async function currentUserId(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.user.id ?? null;
}

export async function loadMembership(): Promise<Membership | null> {
  const data = rows(await getSupabase().rpc("coach_my_membership"));
  return (data[0] as Membership | undefined) ?? null;
}

export interface CoachData {
  goals: Goal[];
  steps: Step[];
  notes: Note[];
  shares: Share[];
  profile: CoachProfile | null;
}

export async function loadCoach(): Promise<CoachData> {
  const sb = getSupabase();
  const uid = await currentUserId();
  if (!uid) throw new Error("Please sign in again.");
  const [goals, steps, notes, shares, profile] = await Promise.all([
    sb.from("coach_goals").select("id,title,why,status,created_at").order("created_at", { ascending: false }),
    sb.from("coach_steps").select("id,goal_id,text,due_at,status,outcome,reflection,followup_status,followup_at,created_at")
      .order("created_at", { ascending: false }),
    sb.from("coach_notes").select("id,goal_id,kind,text,created_at").order("created_at", { ascending: false }).limit(50),
    sb.from("coach_shares").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    sb.from("coach_profiles").select("*").eq("user_id", uid).maybeSingle(),
  ]);
  if (profile.error) throw new Error(profile.error.message);
  return {
    goals: rows(goals) as Goal[],
    steps: rows(steps) as Step[],
    notes: rows(notes) as Note[],
    shares: rows(shares) as Share[],
    profile: (profile.data as CoachProfile | null) ?? null,
  };
}

export async function saveCoachProfile(patch: Partial<CoachProfile>) {
  const uid = await currentUserId();
  const { error } = await getSupabase().from("coach_profiles").upsert({ user_id: uid, ...patch });
  if (error) throw new Error(error.message);
}

export async function addGoal(title: string, why?: string) {
  const uid = await currentUserId();
  const { error } = await getSupabase().from("coach_goals").insert({ user_id: uid, title, why: why || null });
  if (error) throw new Error(error.message);
}
export async function updateGoal(id: string, patch: Partial<Pick<Goal, "title" | "why" | "status">>) {
  const { error } = await getSupabase().from("coach_goals").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}
/** Conditional: only an open step can be closed, so a call and the app can't both record it. */
export async function closeStep(id: string, status: "done" | "partial" | "skipped", outcome: string) {
  const { error } = await getSupabase().from("coach_steps").update({ status, outcome: outcome || null }).eq("id", id).eq("status", "open");
  if (error) throw new Error(error.message);
}
export async function deleteNote(id: string) {
  const { error } = await getSupabase().from("coach_notes").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
export async function deleteGoal(id: string) {
  const { error } = await getSupabase().from("coach_goals").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export const decideShare = (shareId: string, approve: boolean) =>
  invoke<{ status: string }>("coach", { action: "decide_share", share_id: shareId, approve });
export const callMe = (mode: "coach" | "pulse") => invoke<{ status: string }>("coach", { action: "call_me", mode });
export const followupNow = () => invoke<{ status: string }>("coach", { action: "followup_now" });

export async function liveSession(mode: "coach" | "pulse") {
  return invoke<{ token: string; model: string; session_id: string; first_message: string }>("coach", { action: "live_session", mode });
}
export async function liveTool(mode: "coach" | "pulse", sessionId: string, name: string, args: unknown, callId: string) {
  try {
    return (await invoke<{ result: string }>("coach", { action: "live_tool", mode, session_id: sessionId, name, args, call_id: callId })).result;
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : "tool failed"}`;
  }
}

export interface VoiceData {
  invites: Invite[];
  actions: ActionItem[];
}
export async function loadVoice(): Promise<VoiceData> {
  const sb = getSupabase();
  const uid = await currentUserId();
  const [invites, actions] = await Promise.all([
    sb.from("survey_invites").select("campaign_id,status,updated_at,survey_campaigns(title,kind,status,ends_at,starts_at)")
      .eq("user_id", uid).order("updated_at", { ascending: false }).limit(20),
    sb.from("action_items").select("*").eq("published", true).order("published_at", { ascending: false }).limit(20),
  ]);
  return { invites: rows(invites) as unknown as Invite[], actions: rows(actions) as ActionItem[] };
}

// ---- Managers, leadership, HR (aggregates only) --------------------------

const toInsight = (r: Record<string, unknown>): DepartmentInsight => ({
  ...(r as unknown as DepartmentInsight),
  engagement: num(r.engagement),
  score_index: num(r.score_index),
  sentiment: num(r.sentiment),
  enps: num(r.enps),
  attrition_share: num(r.attrition_share),
  prev_engagement: num(r.prev_engagement),
  response_rate: num(r.response_rate),
});

export async function loadDepartments(days = 28): Promise<DepartmentInsight[]> {
  return rows(await getSupabase().rpc("insights_departments", { p_days: days })).map((r) => toInsight(r as Record<string, unknown>));
}
export async function loadTrend(departmentId: string | null, weeks = 12): Promise<TrendPoint[]> {
  return rows(await getSupabase().rpc("insights_trend", { p_department: departmentId, p_weeks: weeks })).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      ...(x as unknown as TrendPoint),
      engagement: num(x.engagement),
      score_index: num(x.score_index),
      sentiment: num(x.sentiment),
      attrition_share: num(x.attrition_share),
    };
  });
}
export async function loadImpact(): Promise<ActionImpact[]> {
  return rows(await getSupabase().rpc("insights_action_impact", { p_days: 28 })).map((r) => {
    const x = r as Record<string, unknown>;
    return {
      ...(x as unknown as ActionImpact),
      before_engagement: num(x.before_engagement),
      after_engagement: num(x.after_engagement),
      before_theme_share: num(x.before_theme_share),
      after_theme_share: num(x.after_theme_share),
    };
  });
}
export async function loadActions(): Promise<ActionItem[]> {
  return rows(await getSupabase().from("action_items").select("*").order("created_at", { ascending: false })) as ActionItem[];
}
export async function saveAction(a: {
  id?: string | null;
  department_id: string | null;
  campaign_id?: string | null;
  theme: string | null;
  title: string;
  detail?: string | null;
  status: ActionItem["status"];
  published: boolean;
}) {
  const { data, error } = await getSupabase().rpc("insights_save_action", {
    p_id: a.id ?? null,
    p_department_id: a.department_id,
    p_campaign_id: a.campaign_id ?? null,
    p_theme: a.theme,
    p_title: a.title,
    p_detail: a.detail ?? null,
    p_status: a.status,
    p_published: a.published,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
export async function loadCampaigns(): Promise<Campaign[]> {
  return rows(
    await getSupabase().from("survey_campaigns").select("id,kind,title,status,starts_at,ends_at,department_ids")
      .order("starts_at", { ascending: false }).limit(30),
  ) as Campaign[];
}
export async function launchCampaign(kind: Campaign["kind"], title: string, departmentIds: string[], days: number) {
  const { data, error } = await getSupabase().rpc("insights_launch_campaign", {
    p_kind: kind,
    p_title: title,
    p_department_ids: departmentIds,
    p_days: days,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
export async function closeCampaign(id: string) {
  const { error } = await getSupabase().rpc("insights_close_campaign", { p_id: id });
  if (error) throw new Error(error.message);
}
export const loadRecommendations = async () => (await invoke<{ items: Recommendation[] }>("coach", { action: "recommendations" })).items;

export interface TeamRequest {
  id: string;
  text: string;
  status: string;
  manager_status: Share["manager_status"];
  manager_note: string | null;
  created_at: string;
  employee_name: string;
}
/** Approved shares addressed to me as a manager, with the name the employee chose to share. */
export async function loadTeamRequests(): Promise<TeamRequest[]> {
  return rows(await getSupabase().rpc("coach_team_requests")) as TeamRequest[];
}
export async function respondToRequest(id: string, status: "acknowledged" | "planned" | "done", note?: string) {
  const { error } = await getSupabase().rpc("coach_share_respond", { p_id: id, p_status: status, p_note: note ?? null });
  if (error) throw new Error(error.message);
}
