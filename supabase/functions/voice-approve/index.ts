import { createTaskStore } from "../_shared/db.ts";
import { executeGoogleAction } from "../_shared/email/actions.ts";
import { authenticate } from "../_shared/http.ts";
import { voiceApproveHandler } from "./handler.ts";

Deno.serve(voiceApproveHandler({
  store: createTaskStore(),
  executeAction: executeGoogleAction,
  authenticate: async (req) => (await authenticate(req)).user.id,
}));
