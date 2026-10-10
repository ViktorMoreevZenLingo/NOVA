// Suggested actions for managers, leadership and HR, generated from AGGREGATES only
// (insights_departments rows, already k >= 5). No answer, note or name is ever an input.
import { type Theme, THEMES } from "./analysis.ts";

export type DepartmentInsight = {
  department_id: string | null;
  name: string;
  responses: number;
  suppressed: boolean;
  engagement: number | null;
  prev_engagement: number | null;
  sentiment: number | null;
  score_index: number | null;
  attrition_share: number | null;
  concerns: Record<string, number> | null;
};

export type Recommendation = { department_id: string | null; department: string; theme: Theme; title: string; detail: string; why: string };
export type Recommender = (rows: DepartmentInsight[]) => Promise<Recommendation[]>;

const PLAYBOOK: Record<Theme, { title: string; detail: string }> = {
  workload: {
    title: "Rebalance workload",
    detail: "Review current priorities with the team, pause or drop one low-value commitment, and agree on a realistic sprint load.",
  },
  growth: {
    title: "Open growth opportunities",
    detail: "Start a project rotation or stretch assignments, and hold a development-focused 1:1 with each person this month.",
  },
  recognition: {
    title: "Make recognition visible",
    detail: "Add a short weekly wins round to the team meeting and recognise specific contributions, not only results.",
  },
  manager_support: {
    title: "Strengthen manager support",
    detail: "Offer the team lead coaching or a lighter load, and make 1:1s regular and protected. Treat this as support, not evaluation.",
  },
  team: {
    title: "Invest in team collaboration",
    detail: "Run a short retro on how the team works together and agree on one collaboration norm to try for a month.",
  },
  clarity: {
    title: "Clarify goals and expectations",
    detail: "Share the quarter's priorities in one page and confirm with each person what success looks like in their role.",
  },
  pay: {
    title: "Explain compensation",
    detail: "Communicate how pay and progression are decided and when the next review happens; involve HR for a Q&A.",
  },
  wellbeing: {
    title: "Protect wellbeing",
    detail: "Check for after-hours load, remind the team of support resources, and encourage taking planned time off.",
  },
  tools: {
    title: "Fix the biggest tooling pain",
    detail: "Ask the team to name the one tool or process that slows them most and assign an owner to fix it.",
  },
  other: {
    title: "Follow up with the team",
    detail: "Discuss the latest results openly with the team and ask what one change would help most.",
  },
};

/** Rules-based suggestions: the top concern per department (share >= 30%), riskiest first. */
export function playbookRecommendations(rows: DepartmentInsight[], max = 5): Recommendation[] {
  const out: Recommendation[] = [];
  const candidates = rows.filter((r) => !r.suppressed && r.department_id && r.concerns)
    .map((r) => {
      const [theme, share] = Object.entries(r.concerns!).filter(([t]) => (THEMES as readonly string[]).includes(t))
        .sort((a, b) => b[1] - a[1])[0] ?? [];
      const drop = r.engagement !== null && r.prev_engagement !== null ? r.prev_engagement - r.engagement : 0;
      return {
        r,
        theme: theme as Theme | undefined,
        share: share ?? 0,
        drop,
        score: (share ?? 0) + Math.max(0, drop) / 20 + (r.attrition_share ?? 0),
      };
    })
    .filter((c) => c.theme && c.share >= 0.3)
    .sort((a, b) => b.score - a.score);
  for (const c of candidates.slice(0, max)) {
    const p = PLAYBOOK[c.theme!];
    const why = [
      `${Math.round(c.share * 100)}% of answers raise ${c.theme!.replace("_", " ")}`,
      c.drop > 0 ? `engagement down ${c.drop.toFixed(0)} points` : "",
      (c.r.attrition_share ?? 0) >= 0.25 ? `${Math.round((c.r.attrition_share ?? 0) * 100)}% show attrition signals` : "",
    ].filter(Boolean).join(", ");
    out.push({ department_id: c.r.department_id, department: c.r.name, theme: c.theme!, title: p.title, detail: p.detail, why });
  }
  return out;
}

const SCHEMA = {
  name: "recommendations",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["department_id", "theme", "title", "detail"],
          properties: {
            department_id: { type: "string" },
            theme: { type: "string", enum: THEMES },
            title: { type: "string" },
            detail: { type: "string" },
          },
        },
      },
    },
  },
};

/** LLM wording over the playbook's picks; falls back to the playbook on any problem. */
export function createOpenAIRecommender(apiKey: string, model = "gpt-4o-mini", fetchFn: typeof fetch = fetch): Recommender {
  return async (rows) => {
    const base = playbookRecommendations(rows);
    if (!base.length) return base;
    try {
      const res = await fetchFn("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          response_format: { type: "json_schema", json_schema: SCHEMA },
          messages: [
            {
              role: "system",
              content:
                "You advise managers and HR on employee engagement. Given aggregated, anonymous team metrics and a draft action per team, rewrite each action as a specific, practical step a manager can start this week (title max 8 words, detail max 35 words). Keep department_id and theme unchanged. Never speculate about individuals and never suggest monitoring or identifying respondents.",
            },
            {
              role: "user",
              content: JSON.stringify({
                teams: base.map(({ department_id, department, theme, why, title, detail }) => ({
                  department_id,
                  department,
                  theme,
                  why,
                  title,
                  detail,
                })),
              }),
            },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return base;
      const parsed = JSON.parse((await res.json())?.choices?.[0]?.message?.content ?? "{}");
      const byKey = new Map(base.map((b) => [`${b.department_id}|${b.theme}`, b]));
      const items = (Array.isArray(parsed?.items) ? parsed.items : []) as Partial<Recommendation>[];
      const merged = items.map((i) => {
        const b = byKey.get(`${i.department_id}|${i.theme}`);
        return b && typeof i.title === "string" && typeof i.detail === "string"
          ? { ...b, title: i.title.slice(0, 80), detail: i.detail.slice(0, 300) }
          : null;
      }).filter((x): x is Recommendation => !!x);
      return merged.length === base.length ? merged : base;
    } catch {
      return base;
    }
  };
}
