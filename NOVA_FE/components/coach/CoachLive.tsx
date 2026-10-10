"use client";

import { useRef } from "react";
import { LiveTalk } from "@/components/home/LiveTalk";
import { liveSession, liveTool } from "@/lib/coach-api";

/** Browser voice session with NOVA Coach or the pulse check-in. No transcript is kept. */
export function CoachLive({ mode, onClose }: { mode: "coach" | "pulse"; onClose: () => void }) {
  const session = useRef<{ id: string; greeting: string } | null>(null);
  return (
    <div className="coach-live">
      <LiveTalk
        persist={false}
        speaker={mode === "coach" ? "NOVA Coach" : "NOVA"}
        getSession={async () => {
          const s = await liveSession(mode);
          session.current = { id: s.session_id, greeting: s.first_message };
          return s;
        }}
        greeting={mode === "coach" ? "Hi, this is NOVA, your coach. Is now a good moment to talk?" : "Hi, this is NOVA with a two-minute anonymous check-in. Is now a good time?"}
        runTool={(name, args, callId) => liveTool(mode, session.current?.id ?? "", name, args, callId || crypto.randomUUID())}
        onClose={onClose}
      />
      <p className="coach-live-note">
        {mode === "coach"
          ? "Private by default. NOVA saves goals, steps and short notes you can edit or delete; it keeps no recording or transcript."
          : "Anonymous to your company: only team-level results for groups of 5+ people. Your words are analysed for themes, then discarded."}
      </p>
    </div>
  );
}
