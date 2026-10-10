"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Icon } from "@/components/ui/Icon";
import { durationLabel, fullDate, type HistoryRecord } from "@/lib/history-data";

function TranscriptBody({ record, kind }: { record: HistoryRecord; kind: "call" | "sms" }) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const you = l("Ти", "You");
  const alo = "NOVA AI";

  if (kind === "sms") {
    return (
      <div className="transcript" tabIndex={0} role="region" aria-label={l("СМС транскрипция", "SMS Transcript")}>
        <p className="chat-event">
          <time dateTime={record.date}>{fullDate(record, lang)}</time>
        </p>
        <div className="transcript-turn incoming" aria-label={alo}>
          <p className="chat-bubble">{record.message?.[lang]}</p>
          <span className="chat-caption">{alo}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="transcript" tabIndex={0} role="region" aria-label={l("Транскрипция на разговора", "Call Transcript")}>
      <p className="chat-event">
        {l("Започнат Разговор", "Call started")} <time dateTime={record.date}>{fullDate(record, lang)}</time>
      </p>
      {(record.transcript || []).map(([time, speaker, words], i) => (
        <div key={i} className={`transcript-turn ${speaker === "user" ? "outgoing" : "incoming"}`} aria-label={speaker === "user" ? you : alo}>
          <p className="chat-bubble">{words[lang]}</p>
          <span className="chat-caption">
            {speaker === "user" ? you : alo} · <time>{time}</time>
          </span>
        </div>
      ))}
      <p className="chat-event">
        {l("Приключен Разговор", "Call ended")} · {record.duration ? durationLabel(record.duration, lang) : ""}
      </p>
    </div>
  );
}

export function Transcript({ record, kind }: { record: HistoryRecord; kind: "call" | "sms" }) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const title = kind === "sms" ? l("СМС транскрипция", "SMS Transcript") : l("Транскрипция на разговора", "Call Transcript");
  const [fullscreen, setFullscreen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (fullscreen && !dialog.open) {
      dialog.showModal();
      document.body.classList.add("transcript-is-fullscreen");
    }
    const onClose = () => {
      document.body.classList.remove("transcript-is-fullscreen");
      setFullscreen(false);
    };
    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [fullscreen]);

  return (
    <aside className="transcript-panel" aria-labelledby="transcript-title">
      <div className="transcript-header">
        <h2 id="transcript-title">{title}</h2>
        <button className="icon-button transcript-expand" aria-label={l("Отвори на цял екран", "Open fullscreen")} onClick={() => setFullscreen(true)}>
          <Icon name="expand" />
        </button>
      </div>
      <TranscriptBody record={record} kind={kind} />
      {fullscreen && (
        <dialog ref={dialogRef} className="transcript-fullscreen" aria-labelledby="fullscreen-transcript-title">
          <div className="transcript-header">
            <h2 id="fullscreen-transcript-title">{title}</h2>
            <button className="icon-button transcript-close" aria-label={l("Затвори", "Close")} autoFocus onClick={() => dialogRef.current?.close()}>
              <Icon name="close" />
            </button>
          </div>
          <TranscriptBody record={record} kind={kind} />
        </dialog>
      )}
    </aside>
  );
}
