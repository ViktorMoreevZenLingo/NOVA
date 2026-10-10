"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { type ActionItem, loadCoach, loadVoice, type Membership, type Step } from "@/lib/coach-api";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });

/** Home summary: your step this week, your next check-in, and the latest "You said, we did". */
export function CoachHomeCard({ membership, onOpen }: { membership: Membership | null; onOpen: (view: "growth" | "voice") => void }) {
  const [step, setStep] = useState<Step | null | undefined>(undefined);
  const [action, setAction] = useState<ActionItem | null>(null);
  const [openCheckin, setOpenCheckin] = useState(false);

  useEffect(() => {
    loadCoach().then((d) => setStep(d.steps.find((s) => s.status === "open") ?? null)).catch(() => setStep(null));
    if (membership) {
      loadVoice().then((v) => {
        setAction(v.actions[0] ?? null);
        setOpenCheckin(v.invites.some((i) => ["pending", "calling", "called", "failed"].includes(i.status) && i.survey_campaigns?.status === "live"));
      }).catch(() => {});
    }
  }, [membership]);

  if (step === undefined) return null;
  return (
    <section aria-labelledby="coach-home-title">
      <div className="home-section-title">
        <h2 id="coach-home-title">Your growth</h2>
        <button className="text-button" onClick={() => onOpen("growth")}>
          My growth <Icon name="chevron" />
        </button>
      </div>
      <div className="coach-home">
        <button className="coach-home-tile" onClick={() => onOpen("growth")}>
          <span className="coach-stat-label">Your step this week</span>
          <strong>{step ? step.text : "Choose one small step with your coach"}</strong>
          <span>{step?.followup_at ? `NOVA checks in ${fmt(step.followup_at)}` : "Talk to NOVA Coach, 10 minutes is enough"}</span>
        </button>
        {membership && (
          <button className="coach-home-tile" onClick={() => onOpen("voice")}>
            <span className="coach-stat-label">{openCheckin ? "Your voice is wanted" : "You said, we did"}</span>
            <strong>{openCheckin ? "A 2-minute anonymous check-in is open" : action ? action.title : "Nothing published yet"}</strong>
            <span>{openCheckin ? "Answer by phone or in the browser" : action ? `${membership.org_name} acted on employee feedback` : "Your feedback shapes what changes"}</span>
          </button>
        )}
      </div>
    </section>
  );
}
