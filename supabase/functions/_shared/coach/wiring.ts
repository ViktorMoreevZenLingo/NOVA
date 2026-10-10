// Real clients for the coach functions (index.ts files only; handlers stay injectable).
import { createServiceClient } from "../db.ts";
import { hasGmail } from "../email/gmail.ts";
import { optionalEnv } from "../env.ts";
import { log } from "../log.ts";
import { execute } from "../tools.ts";
import { createOpenAIClassifier, keywordClassifier } from "./analysis.ts";
import { createShareDelivery } from "./delivery.ts";
import { createOpenAIRecommender, playbookRecommendations, type Recommender } from "./insights.ts";
import type { CoachDeps } from "./service.ts";
import { type CoachStore, createCoachStore } from "./store.ts";

export function employeeNameLookup() {
  const db = createServiceClient();
  return async (userId: string): Promise<string | null> => {
    const { data } = await db.from("profiles").select("name").eq("id", userId).maybeSingle();
    return (data as { name?: string } | null)?.name?.trim() || null;
  };
}

export function coachDeps(store: CoachStore = createCoachStore()): CoachDeps {
  const openai = optionalEnv("OPENAI_API_KEY");
  const model = optionalEnv("OPENAI_ANALYSIS_MODEL") ?? "gpt-4o-mini";
  return {
    store,
    classify: openai ? createOpenAIClassifier(openai, model) : (text) => {
      log.warn("survey.keyword_classifier", {});
      return Promise.resolve(keywordClassifier(text));
    },
    deliverShare: createShareDelivery({
      store,
      employeeName: employeeNameLookup(),
      // From the employee's own Gmail to the manager address they set in the app.
      sendEmail: async (userId, mail) => {
        if (!(await hasGmail(userId))) return false;
        await execute(userId, "send_email", mail);
        return true;
      },
    }),
  };
}

export function recommender(): Recommender {
  const openai = optionalEnv("OPENAI_API_KEY");
  return openai
    ? createOpenAIRecommender(openai, optionalEnv("OPENAI_ANALYSIS_MODEL") ?? "gpt-4o-mini")
    : (rows) => Promise.resolve(playbookRecommendations(rows));
}
