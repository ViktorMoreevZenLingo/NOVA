"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  addGoal,
  callMe,
  closeStep,
  type CoachData,
  decideShare,
  deleteGoal,
  deleteNote,
  followupNow,
  loadCoach,
  type Membership,
  saveCoachProfile,
  type Step,
  updateGoal,
} from "@/lib/coach-api";
import { CoachLive } from "./CoachLive";

const NOTE_LABEL = { motivation: "Motivates you", blocker: "Gets in the way", tension: "Creates tension", insight: "Insight" };
const SHARE_STATUS = { approved: "Shared", sent: "Shared + emailed", rejected: "Discarded", draft: "Waiting for you" };
const MANAGER_STATUS = { new: "Not seen yet", acknowledged: "Seen by your manager", planned: "Your manager plans to act", done: "Done" };

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "");

function dueText(step: Step) {
  if (!step.due_at) return "No due date";
  const days = Math.round((Date.parse(step.due_at) - Date.now()) / 86_400_000);
  return days < 0 ? `Was due ${fmtDate(step.due_at)}` : days === 0 ? "Due today" : `Due ${fmtDate(step.due_at)}`;
}

export function MyGrowth({ membership, notify }: { membership: Membership | null; notify: (msg: string) => void }) {
  const [data, setData] = useState<CoachData | null>(null);
  const [error, setError] = useState("");
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState("");
  const [closing, setClosing] = useState<{ id: string; status: "done" | "partial" | "skipped"; outcome: string } | null>(null);
  const [newGoal, setNewGoal] = useState("");

  const reload = useCallback(() => {
    loadCoach().then(setData).catch((e) => setError(e instanceof Error ? e.message : "Could not load."));
  }, []);
  useEffect(reload, [reload]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) notify(ok);
      reload();
    } catch (e) {
      notify(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy("");
    }
  };

  if (error) return <p role="alert" className="coach-empty">{error}</p>;
  if (!data) return <p className="coach-empty" role="status">Loading…</p>;

  const open = data.steps.filter((s) => s.status === "open");
  const done = data.steps.filter((s) => s.status !== "open");
  const goals = data.goals.filter((g) => g.status === "active" || g.status === "paused");
  const drafts = data.shares.filter((s) => s.status === "draft");
  const shared = data.shares.filter((s) => s.status === "approved" || s.status === "sent");
  const nextCall = open.find((s) => s.followup_status === "scheduled" && s.followup_at);
  const profile = data.profile;
  const managerLabel = membership?.manager_name || profile?.manager_name || "your manager";

  return (
    <section className="coach-page">
      <p className="coach-intro">
        Your private space to grow. Talk to NOVA Coach about where you want to go, what gets in the way and what you tried. You choose one small
        step; NOVA checks in afterwards. Nothing reaches your company unless you approve the exact words.
      </p>

      {live ? (
        <CoachLive mode="coach" onClose={() => { setLive(false); reload(); }} />
      ) : (
        <div className="coach-hero">
          <div>
            <h2>Talk to your coach</h2>
            <p>
              {open.length
                ? `Pick up where you left off: “${open[0].text}”.`
                : goals.length
                ? `Continue with “${goals[0].title}”.`
                : "Not sure what your next step is? Start there. 10 minutes is enough."}
            </p>
          </div>
          <div className="coach-hero-actions">
            <button className="primary" onClick={() => setLive(true)}>
              <Icon name="audiolines" /> Talk in browser
            </button>
            <button className="secondary" disabled={busy === "call"} onClick={() => run("call", () => callMe("coach"), "NOVA is calling you now.")}>
              <Icon name="phone" /> Call me now
            </button>
          </div>
        </div>
      )}

      <div className="coach-grid-2">
        <section aria-labelledby="steps-title" className="coach-card">
          <div className="home-section-title">
            <h2 id="steps-title">Your next step</h2>
            {nextCall && <span>Check-in call {fmtDate(nextCall.followup_at)}</span>}
          </div>
          {!open.length && <p className="coach-empty">No open step. Your coach will help you choose one small, concrete step.</p>}
          {open.map((s) => (
            <div key={s.id} className="coach-step">
              <div>
                <strong>{s.text}</strong>
                <span>{dueText(s)}</span>
              </div>
              {closing?.id === s.id ? (
                <form
                  className="coach-inline-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run("close", () => closeStep(s.id, closing.status, closing.outcome), "Nice work. Progress saved.");
                    setClosing(null);
                  }}
                >
                  <select value={closing.status} onChange={(e) => setClosing({ ...closing, status: e.target.value as "done" })} aria-label="How did it go">
                    <option value="done">Done</option>
                    <option value="partial">Partly</option>
                    <option value="skipped">Didn't happen</option>
                  </select>
                  <input
                    value={closing.outcome}
                    onChange={(e) => setClosing({ ...closing, outcome: e.target.value })}
                    placeholder="What happened? (optional)"
                    maxLength={1000}
                    aria-label="What happened"
                  />
                  <button className="primary" type="submit">Save</button>
                  <button className="text-button" type="button" onClick={() => setClosing(null)}>Cancel</button>
                </form>
              ) : (
                <div className="coach-step-actions">
                  <button className="secondary" onClick={() => setClosing({ id: s.id, status: "done", outcome: "" })}>Record outcome</button>
                  <button
                    className="text-button"
                    title="Demo: pretend the week has passed and get the check-in call now"
                    disabled={busy === "followup"}
                    onClick={() => run("followup", followupNow, "Calling you about this step now.")}
                  >
                    Demo: a week passed
                  </button>
                </div>
              )}
            </div>
          ))}
          {done.length > 0 && (
            <>
              <h3 className="coach-subtitle">Progress</h3>
              <ol className="coach-timeline">
                {done.slice(0, 6).map((s) => (
                  <li key={s.id} className={`status-${s.status}`}>
                    <strong>{s.text}</strong>
                    <span>{s.status === "done" ? "Done" : s.status === "partial" ? "Partly done" : "Didn't happen"}{s.outcome ? `: ${s.outcome}` : ""}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>

        <section aria-labelledby="goals-title" className="coach-card">
          <div className="home-section-title"><h2 id="goals-title">Your goals</h2></div>
          {!goals.length && <p className="coach-empty">No goals yet. Your coach helps you phrase one, or add it here.</p>}
          <ul className="coach-list">
            {goals.map((g) => (
              <li key={g.id}>
                <div>
                  <strong>{g.title}</strong>
                  {g.why && <span>{g.why}</span>}
                </div>
                <div className="coach-row-actions">
                  <button className="text-button" onClick={() => run("goal", () => updateGoal(g.id, { status: "done" }), "Goal completed. Well done!")}>Complete</button>
                  <button className="text-button" onClick={() => run("goal", () => deleteGoal(g.id), "Goal deleted.")}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
          <form
            className="coach-inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newGoal.trim()) return;
              void run("addgoal", () => addGoal(newGoal.trim()), "Goal added.");
              setNewGoal("");
            }}
          >
            <input value={newGoal} onChange={(e) => setNewGoal(e.target.value)} placeholder="Add a goal in your words" maxLength={200} aria-label="New goal" />
            <button className="secondary" type="submit">Add</button>
          </form>
        </section>
      </div>

      <section aria-labelledby="shared-title" className="coach-card">
        <div className="home-section-title">
          <h2 id="shared-title">Shared with your company</h2>
          <span>Only what you approved, word for word</span>
        </div>
        {drafts.map((s) => (
          <div key={s.id} className="coach-share draft">
            <div>
              <span className="coach-chip">Draft for {managerLabel}</span>
              <p>“{s.text}”</p>
            </div>
            <div className="coach-row-actions">
              <button className="primary" disabled={!!busy} onClick={() => run("share", () => decideShare(s.id, true), "Shared with your manager.")}>Share this</button>
              <button className="secondary" disabled={!!busy} onClick={() => run("share", () => decideShare(s.id, false), "Discarded. Nothing was shared.")}>Discard</button>
            </div>
          </div>
        ))}
        {shared.map((s) => (
          <div key={s.id} className="coach-share">
            <div>
              <span className="coach-chip done">{SHARE_STATUS[s.status]} · {fmtDate(s.decided_at ?? s.created_at)}</span>
              <p>“{s.text}”</p>
              <span className={`coach-reply status-${s.manager_status}`}>
                {MANAGER_STATUS[s.manager_status]}
                {s.manager_note ? `: “${s.manager_note}”` : ""}
              </span>
            </div>
          </div>
        ))}
        {!drafts.length && !shared.length && <p className="coach-empty">Nothing shared. When you want your manager to know something, your coach drafts it with you.</p>}
        <div className="coach-private">
          <Icon name="lock" />
          <p>
            <strong>Stays private:</strong> your conversations, notes, worries and feelings. Your manager, HR and leadership can't see them, and
            they are never used in company analytics.
          </p>
        </div>
      </section>

      <section aria-labelledby="notes-title" className="coach-card">
        <div className="home-section-title">
          <h2 id="notes-title">What NOVA remembers</h2>
          <span>Only you can see this. Delete anything.</span>
        </div>
        {!data.notes.length && <p className="coach-empty">Nothing yet.</p>}
        <ul className="coach-list">
          {data.notes.map((n) => (
            <li key={n.id}>
              <div>
                <span className="coach-chip">{NOTE_LABEL[n.kind]}</span>
                <span>{n.text}</span>
              </div>
              <button className="text-button" onClick={() => run("note", () => deleteNote(n.id), "Deleted.")}>Delete</button>
            </li>
          ))}
        </ul>
      </section>

      <CoachSettings
        initial={profile}
        managerFromOrg={membership?.manager_name ?? null}
        onSave={(p) => run("settings", () => saveCoachProfile(p), "Settings saved.")}
      />
    </section>
  );
}

function CoachSettings({
  initial,
  managerFromOrg,
  onSave,
}: {
  initial: CoachData["profile"];
  managerFromOrg: string | null;
  onSave: (p: Parameters<typeof saveCoachProfile>[0]) => void;
}) {
  const [managerName, setManagerName] = useState(initial?.manager_name ?? "");
  const [managerEmail, setManagerEmail] = useState(initial?.manager_email ?? "");
  const [from, setFrom] = useState((initial?.call_from ?? "09:30").slice(0, 5));
  const [to, setTo] = useState((initial?.call_to ?? "18:30").slice(0, 5));
  const [followups, setFollowups] = useState(initial?.followups_enabled ?? true);
  const [surveys, setSurveys] = useState(initial?.surveys_enabled ?? true);
  return (
    <details className="coach-card coach-settings">
      <summary>
        <Icon name="settings" /> Coach settings
      </summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            manager_name: managerName.trim() || null,
            manager_email: managerEmail.trim() || null,
            call_from: from,
            call_to: to,
            followups_enabled: followups,
            surveys_enabled: surveys,
          });
        }}
      >
        <div className="coach-form-grid">
          <label>
            Manager's name
            <input value={managerName} onChange={(e) => setManagerName(e.target.value)} placeholder={managerFromOrg ?? "e.g. Alex"} maxLength={120} />
          </label>
          <label>
            Manager's email (optional)
            <input type="email" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} placeholder="Approved requests are also emailed" />
          </label>
          <label>
            Call me from
            <input type="time" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            until
            <input type="time" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        <label className="coach-check">
          <input type="checkbox" checked={followups} onChange={(e) => setFollowups(e.target.checked)} /> Check-in calls about my steps
        </label>
        <label className="coach-check">
          <input type="checkbox" checked={surveys} onChange={(e) => setSurveys(e.target.checked)} /> Anonymous company check-ins by phone
        </label>
        <p className="coach-fine">
          {managerFromOrg ? `Your company lists ${managerFromOrg} as your manager; approved requests appear in their NOVA app. ` : ""}
          Calls happen on weekdays within these hours. Email is sent from your own connected Gmail.
        </p>
        <button className="primary" type="submit">Save settings</button>
      </form>
    </details>
  );
}
