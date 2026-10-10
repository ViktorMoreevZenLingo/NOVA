"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  type ActionImpact,
  type ActionItem,
  type Campaign,
  closeCampaign,
  type DepartmentInsight,
  launchCampaign,
  loadActions,
  loadCampaigns,
  loadDepartments,
  loadImpact,
  loadRecommendations,
  loadTeamRequests,
  loadTrend,
  type Membership,
  type Recommendation,
  respondToRequest,
  saveAction,
  type TeamRequest,
  THEME_LABELS,
  themeLabel,
  type TrendPoint,
} from "@/lib/coach-api";
import { Delta, heatColor, riskLabel, riskTone, ShareBars, StatTile, TrendChart } from "./charts";

const ONE_ON_ONE: Record<string, string> = {
  workload: "What could we drop or postpone so the week feels manageable?",
  growth: "What would you like to learn next, and which project would stretch you?",
  recognition: "Which recent work are you proud of that deserves more visibility?",
  manager_support: "What could I do differently to support you better?",
  team: "How is collaboration going, and what would make it smoother?",
  clarity: "Is it clear what success looks like in your role this quarter?",
  pay: "Do you understand how pay and progression work here? What's unclear?",
  wellbeing: "How is your energy lately? Is anything outside work weighing on you that we should plan around?",
  tools: "Which tool or process slows you down most?",
  other: "What is one thing that would make your work better?",
};
const ACTION_STATUS = { planned: "Planned", in_progress: "In progress", done: "Done" };

type Scope = "team" | "org";

export function Insights({ scope, membership, notify }: { scope: Scope; membership: Membership; notify: (msg: string) => void }) {
  const [departments, setDepartments] = useState<DepartmentInsight[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [impact, setImpact] = useState<ActionImpact[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [requests, setRequests] = useState<TeamRequest[]>([]);
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [draft, setDraft] = useState<Partial<ActionItem> | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const [d, a, i, c, r] = await Promise.all([
        loadDepartments(28),
        loadActions(),
        loadImpact(),
        loadCampaigns(),
        scope === "team" ? loadTeamRequests() : Promise.resolve([]),
      ]);
      setDepartments(d);
      setActions(a);
      setImpact(i);
      setCampaigns(c);
      setRequests(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load insights.");
    }
  }, [scope]);
  useEffect(() => void reload(), [reload]);
  useEffect(() => {
    loadRecommendations().then(setRecs).catch(() => setRecs([]));
  }, []);
  // Managers look at their own department by default.
  const teamDept = scope === "team" ? membership.department_id : null;
  const focus = selected ?? teamDept;
  useEffect(() => {
    loadTrend(focus, 12).then(setTrend).catch(() => setTrend([]));
  }, [focus]);

  const all = departments?.find((d) => d.department_id === null) ?? null;
  const rows = useMemo(() => (departments ?? []).filter((d) => d.department_id !== null), [departments]);
  const current = focus ? rows.find((d) => d.department_id === focus) ?? null : all;
  const deptName = (id: string | null) => (id ? rows.find((d) => d.department_id === id)?.name ?? "Team" : "Whole organisation");

  if (error) return <p role="alert" className="coach-empty">{error}</p>;
  if (!departments) return <p className="coach-empty" role="status">Loading…</p>;

  const themesOf = (r: DepartmentInsight | null, key: "concerns" | "strengths") =>
    Object.entries(r?.[key] ?? {}).sort((a, b) => b[1] - a[1]).map(([t, share]) => ({ theme: t, label: themeLabel(t), share }));
  const concerns = themesOf(current, "concerns");
  const strengths = themesOf(current, "strengths");
  const heatThemes = Object.keys(THEME_LABELS).filter((t) => rows.some((r) => (r.concerns?.[t] ?? 0) > 0));
  const languageScore = current?.sentiment != null ? Math.round((current.sentiment + 1) * 50) : null;

  const submitAction = async () => {
    if (!draft?.title?.trim()) return;
    try {
      await saveAction({
        id: draft.id ?? null,
        department_id: scope === "team" ? membership.department_id : draft.department_id ?? null,
        theme: draft.theme ?? null,
        title: draft.title.trim(),
        detail: draft.detail ?? null,
        status: (draft.status as ActionItem["status"]) ?? "planned",
        published: draft.published ?? false,
      });
      notify(draft.published ? "Action published to employees." : "Action saved.");
      setDraft(null);
      await reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not save.");
    }
  };

  return (
    <section className="coach-page">
      <p className="coach-intro">
        {scope === "team"
          ? `How ${membership.department_name ?? "your team"} is doing, from anonymous check-ins. You only see results backed by at least 5 people, never individuals or their words. Use it to decide what you can change this week.`
          : `Engagement across ${membership.org_name}, from anonymous voice check-ins. Every number is backed by at least 5 people; smaller groups stay hidden. Words are reduced to themes and discarded.`}
      </p>

      {scope === "org" && rows.length > 0 && (
        <div className="coach-filters" role="group" aria-label="Department">
          <button className={`coach-filter${focus === null ? " active" : ""}`} onClick={() => setSelected(null)}>All</button>
          {rows.map((d) => (
            <button key={d.department_id} className={`coach-filter${focus === d.department_id ? " active" : ""}`} onClick={() => setSelected(d.department_id)}>
              {d.name}
            </button>
          ))}
        </div>
      )}

      {current?.suppressed ? (
        <div className="coach-card coach-suppressed">
          <Icon name="lock" />
          <p>
            <strong>Not enough answers to show {current.name}.</strong> Results need a team of 5+ and a check-in answered by at least 5 people in the last 4 weeks. This protects
            anonymity; results appear once more people answer.
          </p>
        </div>
      ) : current ? (
        <div className="coach-stats">
          <StatTile
            label="Engagement (0-100)"
            value={current.engagement?.toFixed(0) ?? "—"}
            sub={current.prev_engagement !== null && current.engagement !== null
              ? `${current.engagement - current.prev_engagement >= 0 ? "+" : ""}${(current.engagement - current.prev_engagement).toFixed(0)} vs previous 4 weeks`
              : "last 4 weeks"}
          />
          <StatTile
            label="eNPS"
            value={current.enps === null ? "—" : `${current.enps > 0 ? "+" : ""}${current.enps}`}
            sub={current.enps === null ? "From engagement surveys" : "−100 to +100"}
          />
          <StatTile
            label="Response rate"
            value={current.response_rate === null ? "—" : `${Math.round(current.response_rate * 100)}%`}
            sub={`${current.responses} answers`}
          />
          <StatTile
            label="Attrition risk"
            value={riskLabel(current.attrition_share)}
            sub={current.attrition_share === null ? undefined : `${Math.round(current.attrition_share * 100)}% of answers show signals`}
            tone={riskTone(current.attrition_share)}
          />
        </div>
      ) : (
        <p className="coach-empty">No check-ins yet. Launch one below.</p>
      )}

      <div className="coach-grid-2">
        <section className="coach-card" aria-labelledby="trend-title">
          <div className="home-section-title">
            <h2 id="trend-title">Engagement by week</h2>
            <span>{deptName(focus)}</span>
          </div>
          <TrendChart points={trend} />
        </section>

        <section className="coach-card" aria-labelledby="gap-title">
          <div className="home-section-title">
            <h2 id="gap-title">Beyond the scores</h2>
            <span>What the words add</span>
          </div>
          {current && !current.suppressed && languageScore !== null && current.score_index !== null ? (
            <>
              <div className="coach-gap">
                <div><span>Scores say</span><strong>{current.score_index.toFixed(0)}</strong></div>
                <div><span>Words say</span><strong>{languageScore}</strong></div>
              </div>
              <p className="coach-fine">
                {current.score_index - languageScore > 8
                  ? "People rate things higher than they sound. Look at the themes below before trusting the score."
                  : languageScore - current.score_index > 8
                  ? "People sound more positive than their ratings. Good momentum to build on."
                  : "Scores and language agree."}
              </p>
            </>
          ) : (
            <p className="coach-empty">Appears once there are enough answers.</p>
          )}
          <h3 className="coach-subtitle">What's working</h3>
          <ShareBars items={strengths.slice(0, 3)} empty="No strengths mentioned yet." />
        </section>
      </div>

      <div className={scope === "team" ? "coach-grid-2" : "coach-page"}>
        <section className="coach-card" aria-labelledby="concerns-title">
          <div className="home-section-title">
            <h2 id="concerns-title">Top concerns</h2>
            <span>Share of answers</span>
          </div>
          <ShareBars items={concerns.slice(0, 5)} empty="No concerns raised, or not enough answers." />
        </section>

        {scope === "team" ? (
          <section className="coach-card" aria-labelledby="oneonone-title">
            <div className="home-section-title">
              <h2 id="oneonone-title">Bring to your 1:1s</h2>
              <span>Questions for everyone, not one person</span>
            </div>
            {!concerns.length && <p className="coach-empty">Nothing specific yet. Ask: “What is one thing that would make your work better?”</p>}
            <ul className="coach-list">
              {concerns.slice(0, 3).map((c) => (
                <li key={c.theme}>
                  <div>
                    <span className="coach-chip">{c.label}</span>
                    <span>{ONE_ON_ONE[c.theme] ?? ONE_ON_ONE.other}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="coach-card" aria-labelledby="heat-title">
            <div className="home-section-title">
              <h2 id="heat-title">Concerns by department</h2>
              <span>Share of answers raising each theme</span>
            </div>
            <div className="coach-heat-wrap">
              <table className="coach-heat">
                <thead>
                  <tr>
                    <th scope="col">Department</th>
                    <th scope="col">Risk</th>
                    {heatThemes.map((t) => <th key={t} scope="col">{themeLabel(t)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.department_id} className={focus === r.department_id ? "active" : ""} onClick={() => setSelected(r.department_id)}>
                      <th scope="row">{r.name}</th>
                      {r.suppressed ? (
                        <td colSpan={heatThemes.length + 1} className="coach-heat-hidden">Fewer than 5 people answered. Hidden.</td>
                      ) : (
                        <>
                          <td>
                            <span className={`coach-risk tone-${riskTone(r.attrition_share)}`}>
                              <span className="coach-dot" aria-hidden="true" />
                              {riskLabel(r.attrition_share)}
                            </span>
                          </td>
                          {heatThemes.map((t) => {
                            const share = r.concerns?.[t] ?? 0;
                            return (
                              <td key={t} style={heatColor(share)} title={`${r.name}, ${themeLabel(t)}: ${Math.round(share * 100)}%`}>
                                {share ? `${Math.round(share * 100)}%` : ""}
                              </td>
                            );
                          })}
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      <section className="coach-card" aria-labelledby="recs-title">
        <div className="home-section-title">
          <h2 id="recs-title">Suggested actions</h2>
          <span>Generated from team-level results only</span>
        </div>
        {recs === null && <p className="coach-empty" role="status">Thinking…</p>}
        {recs?.length === 0 && <p className="coach-empty">No strong signal right now. Keep the check-ins going.</p>}
        <ul className="coach-recs">
          {recs?.filter((r) => scope === "org" || r.department_id === membership.department_id).map((r) => (
            <li key={`${r.department_id}-${r.theme}`}>
              <div>
                <span className="coach-chip">{r.department} · {themeLabel(r.theme)}</span>
                <strong>{r.title}</strong>
                <p>{r.detail}</p>
                <span className="coach-fine">Why: {r.why}</span>
              </div>
              <button
                className="secondary"
                onClick={() => setDraft({ department_id: r.department_id, theme: r.theme, title: r.title, detail: r.detail, status: "planned", published: false })}
              >
                Create action
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="coach-card" aria-labelledby="actions-title">
        <div className="home-section-title">
          <h2 id="actions-title">Actions and their effect</h2>
          <button className="text-button" onClick={() => setDraft({ department_id: focus, status: "planned", published: false })}>
            New action <Icon name="chevron" />
          </button>
        </div>
        {draft && (
          <form className="coach-action-form" onSubmit={(e) => { e.preventDefault(); void submitAction(); }}>
            <div className="coach-form-grid">
              <label>
                Action
                <input value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={160} required />
              </label>
              <label>
                Theme
                <select value={draft.theme ?? ""} onChange={(e) => setDraft({ ...draft, theme: e.target.value || null })}>
                  <option value="">None</option>
                  {Object.entries(THEME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              {scope === "org" && (
                <label>
                  Department
                  <select value={draft.department_id ?? ""} onChange={(e) => setDraft({ ...draft, department_id: e.target.value || null })}>
                    <option value="">Whole organisation</option>
                    {rows.map((r) => <option key={r.department_id} value={r.department_id!}>{r.name}</option>)}
                  </select>
                </label>
              )}
              <label>
                Status
                <select value={draft.status ?? "planned"} onChange={(e) => setDraft({ ...draft, status: e.target.value as ActionItem["status"] })}>
                  {Object.entries(ACTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            </div>
            <label>
              Details for employees
              <textarea value={draft.detail ?? ""} onChange={(e) => setDraft({ ...draft, detail: e.target.value })} maxLength={1000} rows={2} />
            </label>
            <label className="coach-check">
              <input type="checkbox" checked={!!draft.published} onChange={(e) => setDraft({ ...draft, published: e.target.checked })} />
              Publish to employees as “You said, we did”
            </label>
            <div className="coach-row-actions">
              <button className="primary" type="submit">Save action</button>
              <button className="text-button" type="button" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </form>
        )}
        {!actions.length && !draft && <p className="coach-empty">No actions yet. Turn a suggestion into one; publishing it shows employees their voice mattered.</p>}
        <ul className="coach-actions">
          {actions.map((a) => {
            const im = impact.find((i) => i.action_id === a.id);
            return (
              <li key={a.id}>
                <div>
                  <div className="coach-said-head">
                    <span className="coach-chip">{deptName(a.department_id)}{a.theme ? ` · ${themeLabel(a.theme)}` : ""}</span>
                    <span className={`coach-chip status-${a.status}`}>{ACTION_STATUS[a.status]}</span>
                    {a.published && <span className="coach-chip done">Published</span>}
                  </div>
                  <strong>{a.title}</strong>
                  {im && im.before_engagement !== null && im.after_engagement !== null ? (
                    <span className="coach-impact">
                      Engagement {im.before_engagement.toFixed(0)} → {im.after_engagement.toFixed(0)} <Delta now={im.after_engagement} before={im.before_engagement} />
                      {im.before_theme_share !== null && im.after_theme_share !== null &&
                        ` · ${themeLabel(a.theme)} mentioned by ${Math.round(im.before_theme_share * 100)}% → ${Math.round(im.after_theme_share * 100)}%`}
                      <span className="coach-fine"> (4 weeks before vs after; a correlation, not proof)</span>
                    </span>
                  ) : (
                    <span className="coach-fine">Effect appears once at least 5 people answered before and after.</span>
                  )}
                </div>
                <button className="text-button" onClick={() => setDraft(a)}>Edit</button>
              </li>
            );
          })}
        </ul>
      </section>

      {scope === "team" && <TeamRequests requests={requests} notify={notify} onChange={reload} />}

      <Campaigns scope={scope} rows={rows} campaigns={campaigns} notify={notify} onChange={reload} />
    </section>
  );
}

function TeamRequests({ requests, notify, onChange }: { requests: TeamRequest[]; notify: (m: string) => void; onChange: () => void }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const respond = async (id: string, status: "acknowledged" | "planned" | "done") => {
    try {
      await respondToRequest(id, status, notes[id]);
      notify("Reply sent. Your team member sees it in NOVA.");
      onChange();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not reply.");
    }
  };
  return (
    <section className="coach-card" aria-labelledby="requests-title">
      <div className="home-section-title">
        <h2 id="requests-title">Requests from your team</h2>
        <span>Shared by them, word for word</span>
      </div>
      {!requests.length && <p className="coach-empty">No requests yet. When someone wants more responsibility, training or support, it appears here with their consent.</p>}
      <ul className="coach-list">
        {requests.map((r) => (
          <li key={r.id} className="coach-request">
            <div>
              <span className="coach-chip">{r.employee_name}</span>
              <p>“{r.text}”</p>
              {r.manager_note && <span className="coach-fine">Your reply: “{r.manager_note}”</span>}
            </div>
            <div className="coach-request-actions">
              <input
                placeholder="Reply (optional)"
                value={notes[r.id] ?? ""}
                onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                maxLength={500}
                aria-label={`Reply to ${r.employee_name}`}
              />
              <button className={`secondary${r.manager_status === "acknowledged" ? " on" : ""}`} onClick={() => respond(r.id, "acknowledged")}>Seen</button>
              <button className={`secondary${r.manager_status === "planned" ? " on" : ""}`} onClick={() => respond(r.id, "planned")}>Will act</button>
              <button className={`secondary${r.manager_status === "done" ? " on" : ""}`} onClick={() => respond(r.id, "done")}>Done</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Campaigns({ scope, rows, campaigns, notify, onChange }: {
  scope: Scope;
  rows: DepartmentInsight[];
  campaigns: Campaign[];
  notify: (m: string) => void;
  onChange: () => void;
}) {
  const [kind, setKind] = useState<Campaign["kind"]>("pulse");
  const [title, setTitle] = useState("");
  const [dept, setDept] = useState("");
  const [days, setDays] = useState(7);
  const launch = async () => {
    try {
      await launchCampaign(scope === "team" ? "pulse" : kind, title || (kind === "pulse" ? "Pulse check-in" : "Engagement survey"), dept ? [dept] : [], days);
      notify("Check-in launched. NOVA calls people within their call hours.");
      setTitle("");
      onChange();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not launch.");
    }
  };
  const live = campaigns.filter((c) => c.status === "live");
  return (
    <section className="coach-card" aria-labelledby="campaigns-title">
      <div className="home-section-title">
        <h2 id="campaigns-title">Check-ins</h2>
        <span>{live.length ? `${live.length} running` : "None running"}</span>
      </div>
      <form className="coach-inline-form" onSubmit={(e) => { e.preventDefault(); void launch(); }}>
        {scope === "org" && (
          <select value={kind} onChange={(e) => setKind(e.target.value as Campaign["kind"])} aria-label="Type">
            <option value="pulse">Pulse (3 questions)</option>
            <option value="engagement">Engagement survey (eNPS + 4)</option>
          </select>
        )}
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" maxLength={120} aria-label="Title" />
        {scope === "org" && (
          <select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Audience">
            <option value="">Everyone</option>
            {rows.map((r) => <option key={r.department_id} value={r.department_id!}>{r.name}</option>)}
          </select>
        )}
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Open for">
          <option value={3}>3 days</option>
          <option value={7}>1 week</option>
          <option value={14}>2 weeks</option>
        </select>
        <button className="primary" type="submit">Launch</button>
      </form>
      <ul className="coach-list">
        {campaigns.slice(0, 6).map((c) => (
          <li key={c.id}>
            <div>
              <strong>{c.title}</strong>
              <span>
                {c.kind === "pulse" ? "Pulse" : "Engagement"} · {new Date(c.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                {c.status === "live" ? " · running" : " · closed"}
              </span>
            </div>
            {c.status === "live" && (
              <button className="text-button" onClick={() => closeCampaign(c.id).then(onChange).catch((e) => notify(e.message))}>Close</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
