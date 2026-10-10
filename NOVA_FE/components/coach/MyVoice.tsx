"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { callMe, loadVoice, type Membership, themeLabel, type VoiceData } from "@/lib/coach-api";
import { CoachLive } from "./CoachLive";

const STATUS = { planned: "Planned", in_progress: "In progress", done: "Done" };
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "");

export function MyVoice({ membership, notify }: { membership: Membership | null; notify: (msg: string) => void }) {
  const [data, setData] = useState<VoiceData | null>(null);
  const [live, setLive] = useState(false);
  const reload = useCallback(() => {
    loadVoice().then(setData).catch((e) => notify(e instanceof Error ? e.message : "Could not load."));
  }, [notify]);
  useEffect(reload, [reload]);

  if (!membership) {
    return (
      <section className="coach-page">
        <p className="coach-empty">Your account isn't linked to a company in NOVA yet. Your personal coach still works under My growth.</p>
      </section>
    );
  }
  if (!data) return <p className="coach-empty" role="status">Loading…</p>;

  const open = data.invites.find((i) => ["pending", "calling", "called", "failed"].includes(i.status) && i.survey_campaigns?.status === "live");
  const answered = data.invites.filter((i) => i.status === "answered").length;

  return (
    <section className="coach-page">
      <p className="coach-intro">
        Your honest voice helps {membership.org_name} improve how it works. Check-ins take two minutes by phone or in the browser, and they are
        anonymous: your company only sees team-level results for groups of at least 5 people, never your words.
      </p>

      {live ? (
        <CoachLive mode="pulse" onClose={() => { setLive(false); reload(); }} />
      ) : open ? (
        <div className="coach-hero">
          <div>
            <h2>{open.survey_campaigns?.title ?? "Check-in"}</h2>
            <p>Open until {fmt(open.survey_campaigns?.ends_at ?? null)}. 3 short questions; say as much or as little as you like.</p>
          </div>
          <div className="coach-hero-actions">
            <button className="primary" onClick={() => setLive(true)}>
              <Icon name="audiolines" /> Answer in browser
            </button>
            <button className="secondary" onClick={() => callMe("pulse").then(() => notify("NOVA is calling you now.")).catch((e) => notify(e.message))}>
              <Icon name="phone" /> Call me
            </button>
          </div>
        </div>
      ) : (
        <div className="coach-card coach-thanks">
          <Icon name="check" />
          <p>{answered ? `Thank you. You've shared your voice in ${answered} check-in${answered === 1 ? "" : "s"}. No open check-in right now.` : "No open check-in right now."}</p>
        </div>
      )}

      <section aria-labelledby="said-title" className="coach-card">
        <div className="home-section-title">
          <h2 id="said-title">You said, we did</h2>
          <span>What changed because people spoke up</span>
        </div>
        {!data.actions.length && <p className="coach-empty">Nothing published yet. When your team acts on feedback, it shows up here.</p>}
        <ul className="coach-said">
          {data.actions.map((a) => (
            <li key={a.id}>
              <div className="coach-said-head">
                {a.theme && <span className="coach-chip">You said: {themeLabel(a.theme).toLowerCase()}</span>}
                <span className={`coach-chip status-${a.status}`}>{STATUS[a.status]}</span>
              </div>
              <strong>{a.title}</strong>
              {a.detail && <p>{a.detail}</p>}
              <span className="coach-fine">Since {fmt(a.published_at ?? a.created_at)}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="coach-private">
        <Icon name="lock" />
        <p>
          <strong>How anonymity works:</strong> NOVA stores your numbers and a few themes (like “workload” or “growth”) without your name and
          deletes your words. Groups smaller than 5 are never shown. Your personal coaching is never part of this.
        </p>
      </div>
    </section>
  );
}
