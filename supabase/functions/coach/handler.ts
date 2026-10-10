// Browser API for NOVA Coach (signed-in user only):
//   live_session {mode}            → short-lived OpenAI Realtime token with coach/pulse instructions + tools
//   live_tool {session_id, name, args, call_id} → runs one coach/pulse tool for the signed-in user
//   decide_share {share_id, approve} → approve (and deliver) or reject a draft from the app
//   call_me {mode}                 → outbound phone call now (coach session or the open survey)
//   followup_now                   → demo: "a week has passed", call about the latest open step now
//   recommendations                → suggested actions from the caller's aggregates (k >= 5 only)
import { log } from "../_shared/log.ts";
import {
  COACH_FIRST_MESSAGE,
  COACH_INSTRUCTIONS,
  COACH_TOOLS,
  PULSE_FIRST_MESSAGE,
  PULSE_INSTRUCTIONS,
  PULSE_TOOLS,
} from "../_shared/coach/prompts.ts";
import type { DepartmentInsight, Recommender } from "../_shared/coach/insights.ts";
import { type Dialer, runCoachWorker } from "../_shared/coach/outbound.ts";
import { type CoachTool, type DeliverShare, formatContext } from "../_shared/coach/service.ts";
import type { CoachStore, Share } from "../_shared/coach/store.ts";

export class CoachHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export type RealtimeSession = { token: string; model: string };
export type MintRealtime = (session: { instructions: string; tools: typeof COACH_TOOLS }) => Promise<RealtimeSession>;

export type CoachApiDeps = {
  /** Resolves the signed-in user from the request (throws CoachHttpError 401). */
  authenticate: (req: Request) => Promise<{ userId: string; token: string }>;
  store: CoachStore;
  tools: Record<string, CoachTool>;
  deliverShare: DeliverShare;
  mintRealtime: MintRealtime;
  dial: Dialer | null;
  /** The caller's own aggregates, read with their JWT so insights_scope applies. */
  departments: (token: string) => Promise<DepartmentInsight[]>;
  recommend: Recommender;
  employeeName: (userId: string) => Promise<string | null>;
  now?: () => Date;
};

const MODE_TOOLS = { coach: COACH_TOOLS, pulse: PULSE_TOOLS };
const NO_PHONE = "Phone calls are not configured yet. Use Talk in browser instead.";

export function coachApiHandler(deps: CoachApiDeps, cors: Record<string, string>) {
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: cors });
  const now = deps.now ?? (() => new Date());

  async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") throw new CoachHttpError(405, "Method not allowed");
    const { userId, token } = await deps.authenticate(req);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const mode = body.mode === "pulse" ? "pulse" : "coach";

    switch (body.action) {
      case "live_session": {
        let instructions = mode === "coach" ? COACH_INSTRUCTIONS : PULSE_INSTRUCTIONS;
        if (mode === "coach") {
          instructions += `\n\nCONTEXT (already loaded, no need to call coach_recall)\n${
            formatContext(await deps.store.context(userId), now())
          }`;
        } else if (!(await deps.store.openInvite(userId))) {
          throw new CoachHttpError(409, "You have no open check-in right now.");
        }
        const session = await deps.mintRealtime({ instructions, tools: MODE_TOOLS[mode] });
        return json({
          ...session,
          session_id: crypto.randomUUID(),
          first_message: mode === "coach" ? COACH_FIRST_MESSAGE : PULSE_FIRST_MESSAGE,
        });
      }

      case "live_tool": {
        const name = typeof body.name === "string" ? body.name : "";
        const sessionId = typeof body.session_id === "string" ? body.session_id.slice(0, 64) : "";
        const callId = typeof body.call_id === "string" ? body.call_id.slice(0, 128) : crypto.randomUUID();
        if (!sessionId) throw new CoachHttpError(400, "Missing session.");
        if (!MODE_TOOLS[mode].some((t) => t.name === name)) throw new CoachHttpError(400, "Unknown tool");
        const args = body.args && typeof body.args === "object" ? body.args as Record<string, unknown> : {};
        const result = await deps.tools[name]({ userId, toolCallId: `live:${sessionId}:${callId}`, sessionId, via: "call" }, args);
        return json({ result });
      }

      case "decide_share": {
        const share = typeof body.share_id === "string" ? await deps.store.getShare(body.share_id) : null;
        if (!share || share.user_id !== userId) throw new CoachHttpError(404, "Not found.");
        const patch = { approved_via: "app", decided_at: now().toISOString() } as Partial<Share>;
        if (body.approve !== true) {
          const rejected = await deps.store.transitionShare(share.id, ["draft"], { ...patch, status: "rejected" });
          if (!rejected) throw new CoachHttpError(409, "This draft was already decided.");
          return json({ status: "rejected" });
        }
        const approved = await deps.store.transitionShare(share.id, ["draft"], { ...patch, status: "approved" });
        if (!approved) throw new CoachHttpError(409, "This draft was already decided.");
        const delivered = await deps.deliverShare(approved);
        log.info("coach.share_approved", { shareId: share.id, via: "app", delivered });
        return json({ status: delivered === "emailed" ? "sent" : "approved", delivered });
      }

      case "call_me": {
        if (!deps.dial) throw new CoachHttpError(409, NO_PHONE);
        const phone = await deps.store.phoneForUser(userId);
        if (!phone) throw new CoachHttpError(409, "Add your phone number to your NOVA account first.");
        if (mode === "pulse") {
          const open = await deps.store.openInvite(userId);
          if (!open) throw new CoachHttpError(409, "You have no open check-in right now.");
          await deps.dial({
            assistant: "pulse",
            phone,
            firstMessage: PULSE_FIRST_MESSAGE,
            metadata: { kind: "survey", campaign_id: open.campaign.id },
          });
        } else {
          await deps.dial({ assistant: "coach", phone, firstMessage: COACH_FIRST_MESSAGE, metadata: { kind: "coach" } });
        }
        return json({ status: "calling" });
      }

      case "followup_now": {
        if (!deps.dial) throw new CoachHttpError(409, NO_PHONE);
        const step = await deps.store.latestOpenStep(userId);
        if (!step) throw new CoachHttpError(409, "You have no open step to follow up on.");
        // Moving the due date reschedules the follow-up (DB trigger), then we place it now.
        await deps.store.transitionStep(userId, step.id, ["open"], { due_at: new Date(now().getTime() - 60_000).toISOString() });
        const report = await runCoachWorker(
          { store: deps.store, dial: deps.dial, now, employeeName: deps.employeeName },
          { followupsFor: userId, ignoreWindow: true, limit: 1 },
        );
        if (!report.followups) throw new CoachHttpError(502, "The follow-up call could not be placed.");
        return json({ status: "calling" });
      }

      case "recommendations": {
        const rows = await deps.departments(token);
        return json({ items: await deps.recommend(rows) });
      }

      default:
        throw new CoachHttpError(400, "Unknown action");
    }
  }

  return async (req: Request): Promise<Response> => {
    try {
      return await handle(req);
    } catch (err) {
      if (err instanceof CoachHttpError) return json({ error: err.message }, err.status);
      log.error("coach.api_error", { error: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
      return json({ error: "The request could not be completed. Please try again." }, 500);
    }
  };
}
