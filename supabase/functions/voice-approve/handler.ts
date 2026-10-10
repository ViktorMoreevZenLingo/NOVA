// Layer L4 from the Alo app (when online): approve or reject a phone-requested
// action. The same rules as approval by phone (see _shared/approval.ts).
//
//   POST { taskId, approved: boolean, body?: string }   (body = edited email text)
import { type ApprovalDeps, ApprovalError, decideTask } from "../_shared/approval.ts";
import { cors, failure, HttpError, json } from "../_shared/http.ts";

export type VoiceApproveDeps = ApprovalDeps & {
  /** Returns the signed-in user's id (Alo's phone-verified session) or throws HttpError(401). */
  authenticate(req: Request): Promise<string>;
};

const STATUS: Record<ApprovalError["code"], number> = { not_found: 404, conflict: 409, invalid: 400, failed: 502 };

export function voiceApproveHandler(deps: VoiceApproveDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
    try {
      if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
      const userId = await deps.authenticate(req);
      const input = await req.json().catch(() => null);
      if (typeof input?.taskId !== "string" || typeof input?.approved !== "boolean") {
        throw new HttpError(400, "Send taskId and approved.");
      }
      const result = await decideTask(deps, {
        taskId: input.taskId,
        userId,
        approve: input.approved,
        via: "app",
        editedBody: typeof input.body === "string" ? input.body : undefined,
      });
      return json(result);
    } catch (err) {
      return failure(err instanceof ApprovalError ? new HttpError(STATUS[err.code], err.message) : err);
    }
  };
}
