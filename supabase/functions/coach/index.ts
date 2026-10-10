import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { authenticate, cors, env, HttpError } from "../_shared/http.ts";
import { optionalEnv } from "../_shared/env.ts";
import type { DepartmentInsight } from "../_shared/coach/insights.ts";
import { vapiDialerFromEnv } from "../_shared/coach/outbound.ts";
import { coachTools } from "../_shared/coach/service.ts";
import { coachDeps, employeeNameLookup, recommender } from "../_shared/coach/wiring.ts";
import { coachApiHandler, CoachHttpError, type MintRealtime } from "./handler.ts";

const MODEL = optionalEnv("OPENAI_REALTIME_MODEL") ?? "gpt-realtime-mini";
const VOICE = optionalEnv("OPENAI_REALTIME_VOICE") ?? "marin";
const TRANSCRIBE_MODEL = optionalEnv("OPENAI_REALTIME_TRANSCRIBE_MODEL") ?? "gpt-4o-transcribe";

// Same client-secret flow as the Live talk `realtime` function; the OpenAI key stays here.
const mintRealtime: MintRealtime = async ({ instructions, tools }) => {
  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: MODEL,
        instructions,
        audio: { input: { transcription: { model: TRANSCRIBE_MODEL, language: "en" } }, output: { voice: VOICE } },
        tools: tools.map((t) => ({ type: "function", ...t })),
        tool_choice: "auto",
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new CoachHttpError(502, "Could not start a live session.");
  const data = await res.json();
  const token = data.value || data.client_secret?.value;
  if (!token) throw new CoachHttpError(502, "No session token returned.");
  return { token, model: MODEL };
};

const deps = coachDeps();

Deno.serve(coachApiHandler({
  authenticate: async (req) => {
    try {
      const { user, token } = await authenticate(req);
      return { userId: user.id, token };
    } catch (err) {
      throw new CoachHttpError(err instanceof HttpError ? err.status : 401, "Please sign in again.");
    }
  },
  store: deps.store,
  tools: coachTools(deps),
  deliverShare: deps.deliverShare,
  mintRealtime,
  dial: vapiDialerFromEnv(),
  departments: async (token) => {
    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await db.rpc("insights_departments", { p_days: 28 });
    if (error) throw new Error("insights_departments failed");
    return (data ?? []) as DepartmentInsight[];
  },
  recommend: recommender(),
  employeeName: employeeNameLookup(),
}, cors()));
