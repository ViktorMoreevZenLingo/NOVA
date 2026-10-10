// Coach and survey tools, independent of the channel. The phone (Vapi) and the
// browser live session both resolve the user from authenticated identity and pass it in;
// the model never supplies a user, a recipient or a campaign it is not invited to.
import { log } from "../log.ts";
import { analyzeAnswers, type Answer, type Classifier } from "./analysis.ts";
import type { CoachContext, CoachStore, NoteKind, Share, Step, StepStatus } from "./store.ts";

export type DeliverShare = (share: Share) => Promise<"in_app" | "emailed">;
export type CoachDeps = { store: CoachStore; classify: Classifier; deliverShare: DeliverShare; now?: () => Date };
/** sessionId: the Vapi call id or the browser live-session id. Voice approval is bound to it. */
export type ToolContext = { userId: string; toolCallId: string; sessionId: string; via: "call" | "app" };
export type CoachTool = (ctx: ToolContext, args: Record<string, unknown>) => Promise<string>;

const NOTE_KINDS = new Set<NoteKind>(["motivation", "blocker", "tension", "insight"]);
const OUTCOMES = new Set<StepStatus>(["done", "partial", "skipped"]);
const DAY_MS = 86_400_000;

function text(args: Record<string, unknown>, name: string, max: number): string | undefined {
  const v = args[name];
  if (typeof v !== "string") return undefined;
  const clean = v.replace(/\s+/g, " ").trim();
  return clean ? clean.slice(0, max) : undefined;
}

function uuid(args: Record<string, unknown>, name: string): string | undefined {
  const v = text(args, name, 64)?.replace(/^(goal|step):/, "");
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : undefined;
}

export function coachTools(deps: CoachDeps): Record<string, CoachTool> {
  const now = deps.now ?? (() => new Date());
  const { store } = deps;

  const ownGoal = async (userId: string, goalId: string | undefined) => goalId && (await store.getGoal(userId, goalId)) ? goalId : null;

  return {
    async coach_recall({ userId }) {
      return formatContext(await store.context(userId), now());
    },

    async coach_save_goal({ userId }, args) {
      const goalId = uuid(args, "goal_id");
      const title = text(args, "title", 200);
      const why = text(args, "why", 1000);
      const status = text(args, "status", 16);
      const validStatus = status && ["active", "paused", "done", "dropped"].includes(status) ? status as "active" : undefined;
      if (goalId) {
        const updated = await store.updateGoal(userId, goalId, {
          ...(title ? { title } : {}),
          ...(why ? { why } : {}),
          ...(validStatus ? { status: validStatus } : {}),
        });
        return updated ? `Goal updated: "${updated.title}" (${updated.status}).` : "That goal was not found; call coach_recall.";
      }
      if (!title) return "Missing title: ask the employee how they would phrase the goal.";
      const goal = await store.insertGoal(userId, { title, why });
      return `Goal saved [goal:${goal.id}]: "${goal.title}".`;
    },

    async coach_save_note({ userId }, args) {
      const kind = text(args, "kind", 16) as NoteKind | undefined;
      const body = text(args, "text", 1000);
      if (!kind || !NOTE_KINDS.has(kind) || !body) return "Need kind (motivation|blocker|tension|insight) and a short text.";
      await store.insertNote(userId, { kind, text: body, goal_id: await ownGoal(userId, uuid(args, "goal_id")) });
      return "Noted. The employee can see and delete notes in the NOVA app.";
    },

    async coach_commit_step({ userId, toolCallId }, args) {
      const body = text(args, "text", 300);
      const days = Math.round(Number(args.due_in_days));
      if (!body) return "Missing step text: let the employee phrase one small concrete step.";
      if (!Number.isFinite(days) || days < 1 || days > 60) return "Ask when they will do it (between 1 and 60 days from today).";
      const dueAt = new Date(now().getTime() + days * DAY_MS).toISOString();
      const { step } = await store.insertStep(userId, {
        text: body,
        due_at: dueAt,
        goal_id: await ownGoal(userId, uuid(args, "goal_id")),
        source_tool_call_id: toolCallId,
      });
      const profile = await store.profile(userId);
      const followup = profile.followups_enabled
        ? `NOVA will call to hear how it went on or after ${dueAt.slice(0, 10)}, within their call hours.`
        : "Follow-up calls are switched off in their settings, so they can call NOVA when ready.";
      return `Step saved [step:${step.id}], due ${dueAt.slice(0, 10)}. ${followup}`;
    },

    async coach_record_outcome({ userId }, args) {
      const status = text(args, "status", 16) as StepStatus | undefined;
      const outcome = text(args, "outcome", 1000);
      if (!status || !OUTCOMES.has(status) || !outcome) return "Need status (done|partial|skipped) and the outcome in their words.";
      const stepId = uuid(args, "step_id");
      const step = stepId ? await store.getStep(userId, stepId) : await store.latestOpenStep(userId);
      if (!step) return "No open step found; call coach_recall.";
      const updated = await store.transitionStep(userId, step.id, ["open"], {
        status,
        outcome,
        reflection: text(args, "reflection", 1000) ?? null,
      });
      if (!updated) return `That step was already recorded as ${step.status}.`;
      return `Recorded: "${updated.text}" is ${status}. Acknowledge their effort, then explore the next small step if they want one.`;
    },

    async coach_propose_share({ userId, toolCallId, sessionId }, args) {
      const body = text(args, "text", 500);
      if (!body) return "Missing text: draft one or two first-person sentences with the employee.";
      const [membership, profile] = await Promise.all([store.membership(userId), store.profile(userId)]);
      const recipientUser = membership?.manager_user_id ?? null;
      const recipientEmail = profile.manager_email;
      if (!recipientUser && !recipientEmail) {
        return "No manager is set up for this employee, so nothing was drafted. They can add their manager's email in the NOVA app under My growth, settings.";
      }
      const share = await store.insertShare({
        user_id: userId,
        goal_id: await ownGoal(userId, uuid(args, "goal_id")),
        text: body,
        recipient_user_id: recipientUser,
        recipient_email: recipientEmail,
        source_call_id: sessionId,
        source_tool_call_id: toolCallId,
      });
      const who = profile.manager_name ? `their manager, ${profile.manager_name}` : "their manager";
      return `Draft saved, NOT sent. Recipient: ${who} (set in NOVA, cannot be changed here). Read this back word for word: "${share.text}". Then ask for a clear yes or no and call coach_decide_share.`;
    },

    async coach_decide_share({ userId, sessionId, via }, args) {
      if (typeof args.approve !== "boolean") return "Ask for a clear yes or no first.";
      const draft = await store.latestDraft(userId, sessionId);
      if (!draft) return "There is no draft read back in this conversation. Nothing was shared.";
      const decidedAt = now().toISOString();
      if (!args.approve) {
        const rejected = await store.transitionShare(
          draft.id,
          ["draft"],
          { status: "rejected", approved_via: via, decided_at: decidedAt } as Partial<Share>,
        );
        return rejected ? "Discarded. Nothing was shared." : "That draft was already decided.";
      }
      const approved = await store.transitionShare(
        draft.id,
        ["draft"],
        { status: "approved", approved_via: via, decided_at: decidedAt } as Partial<Share>,
      );
      if (!approved) return "That draft was already decided.";
      const delivered = await deps.deliverShare(approved);
      log.info("coach.share_approved", { shareId: approved.id, via, delivered });
      return delivered === "emailed"
        ? "Approved and sent. Their manager can see it in NOVA and received it by email. Nothing else from this conversation was shared."
        : "Approved. Their manager can now see it in NOVA. Nothing else from this conversation was shared.";
    },

    async survey_get_questions({ userId }) {
      const open = await store.openInvite(userId);
      if (!open) return "There is no open survey for this employee right now.";
      await store.markInviteCalled(userId, open.campaign.id);
      const questions = open.campaign.questions.map((q, i) =>
        `${i + 1}. [${q.id}] ${q.type === "enps" ? "(number 0-10) " : q.type === "scale" ? "(number 1-5) " : "(open) "}${q.text}`
      );
      return `Survey "${open.campaign.title}". Ask in this order:\n${questions.join("\n")}`;
    },

    async survey_submit({ userId }, args) {
      const open = await store.openInvite(userId);
      if (!open) return "There is no open survey (it may already be answered). Thank them.";
      const answers: Answer[] = Array.isArray(args.answers)
        ? args.answers.filter((a): a is Answer => !!a && typeof a === "object" && typeof (a as Answer).question_id === "string")
          .slice(0, 20)
        : [];
      if (!answers.length) return "No answers to submit. Ask the questions first.";
      const record = await analyzeAnswers(open.campaign.questions, answers, deps.classify);
      const saved = await store.recordResponse(userId, open.campaign.id, record);
      if (!saved) return "This survey was already answered. Thank them.";
      log.info("survey.answered", { campaignId: open.campaign.id });
      const context = await store.context(userId);
      return `Recorded anonymously; the words were analysed for themes and discarded.${formatActions(context)}`;
    },

    async survey_decline({ userId }) {
      const open = await store.openInvite(userId);
      if (!open) return "There is no open survey.";
      await store.declineInvite(userId, open.campaign.id);
      return "Declined. Nothing was recorded and they will not be called again for this survey.";
    },
  };
}

function relativeDue(step: Step, today: Date): string {
  if (!step.due_at) return "no due date";
  const days = Math.round((Date.parse(step.due_at) - today.getTime()) / DAY_MS);
  return days < 0 ? `was due ${-days} day(s) ago` : days === 0 ? "due today" : `due in ${days} day(s)`;
}

function formatActions(c: CoachContext): string {
  if (!c.actions.length) return "";
  return `\nWhat the company changed from employee feedback ("You said, we did"):\n${
    c.actions.map((a) => `- ${a.title} (${a.status.replace("_", " ")})`).join("\n")
  }`;
}

export function formatContext(c: CoachContext, today: Date): string {
  const lines = [`Today: ${today.toISOString().slice(0, 10)}.`, c.name ? `Employee: ${c.name}.` : "Employee name unknown."];
  const empty = !c.goals.length && !c.openSteps.length && !c.recentSteps.length && !c.notes.length;
  if (empty) lines.push("This is your first conversation with this employee. Start by asking what they would like to work on.");
  if (c.goals.length) {
    lines.push("Goals:", ...c.goals.map((g) => `- [goal:${g.id}] ${g.title} (${g.status})${g.why ? `; why: ${g.why}` : ""}`));
  }
  if (c.openSteps.length) {
    lines.push(
      "Open steps (ask about these first if due):",
      ...c.openSteps.map((s) => `- [step:${s.id}] ${s.text}; ${relativeDue(s, today)}`),
    );
  }
  if (c.recentSteps.length) {
    lines.push("Recent outcomes:", ...c.recentSteps.map((s) => `- ${s.text}: ${s.status}${s.outcome ? `; ${s.outcome}` : ""}`));
  }
  if (c.notes.length) lines.push("Notes (newest first):", ...c.notes.map((n) => `- ${n.kind}: ${n.text}`));
  if (c.pendingShares.length) {
    lines.push(
      "Drafts for the manager the employee has not decided on (decide in the app, or draft again here):",
      ...c.pendingShares.map((s) => `- "${s.text}"`),
    );
  }
  if (c.managerReplies.length) {
    lines.push(
      "Manager replies to what the employee shared:",
      ...c.managerReplies.map((s) => `- "${s.text}": ${s.manager_status}${s.manager_note ? `; "${s.manager_note}"` : ""}`),
    );
  }
  return (lines.join("\n") + formatActions(c)).slice(0, 6000);
}
