// Vapi tool endpoint for the NOVA Coach and NOVA Pulse assistants. The employee is the
// authenticated caller number (inbound) or the number we dialled (outbound); arguments
// never choose the account.
import { AUTH_ERROR_MESSAGES, authenticateCaller } from "../_shared/caller.ts";
import { hasVapiSecret } from "../_shared/crypto.ts";
import type { TaskStore } from "../_shared/db.ts";
import type { CoachTool } from "../_shared/coach/service.ts";
import { type ToolHandler, vapiToolEndpoint } from "../_shared/vapi.ts";

export type CoachToolsDeps = { taskStore: TaskStore; tools: Record<string, CoachTool> };

/** additionalVapiSecret: also accept the delegation credential the existing Vapi tools use (same as voice-tools). */
export function coachToolsHandler(deps: CoachToolsDeps, config: { vapiSecret: string; additionalVapiSecret?: string }) {
  const handlers: Record<string, ToolHandler> = {};
  for (const [name, tool] of Object.entries(deps.tools)) {
    handlers[name] = async (call, req) => {
      const auth = await authenticateCaller(deps.taskStore, { mode: "phone" }, req, undefined);
      if (!auth.ok) return { toolCallId: call.id, error: AUTH_ERROR_MESSAGES[auth.reason] };
      const result = await tool({ userId: auth.profile.user_id, toolCallId: call.id, sessionId: req.callId, via: "call" }, call.args);
      return { toolCallId: call.id, result };
    };
  }
  const primary = vapiToolEndpoint(config.vapiSecret, handlers);
  if (!config.additionalVapiSecret) return primary;
  const additional = vapiToolEndpoint(config.additionalVapiSecret, handlers);
  return async (req: Request) => (await hasVapiSecret(req, config.additionalVapiSecret!)) ? additional(req) : primary(req);
}
