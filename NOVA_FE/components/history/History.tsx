"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import {
  defaultFilters,
  filterRecords,
  fullDate,
  type HistoryRecord,
} from "@/lib/history-data";
import { loadChat } from "@/lib/agent-api";
import { loadChatSessions, type ChatSession } from "@/lib/account-api";
import { Icon } from "@/components/ui/Icon";
import { HistoryLegend, HistoryRow, StatusIndicator } from "./HistoryRow";
import { HistoryToolbar } from "./HistoryToolbar";
import { TaskControls } from "./TaskControls";
import { Transcript } from "./Transcript";

interface HistoryProps {
  records: HistoryRecord[];
  onTaskUpdated?: () => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

interface ChatMessage {
  role: "user" | "alo";
  text: string;
}

interface ChatEntry {
  id: string;
  title: string | null;
  messages: ChatMessage[];
  /** Archive time (ISO); null for the current, still-active conversation. */
  when: string | null;
}

export function History({ records, selected, onSelect, onTaskUpdated }: HistoryProps) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const [filters, setFilters] = useState(defaultFilters());

  // Chat history: the current (unarchived) conversation plus archived sessions.
  const [chats, setChats] = useState<ChatEntry[]>([]);
  const [openChatId, setOpenChatId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    Promise.all([
      loadChat().then((d) => d.messages).catch(() => [] as ChatMessage[]),
      loadChatSessions().catch(() => [] as ChatSession[]),
    ]).then(([current, sessions]) => {
      if (!active) return;
      const list: ChatEntry[] = [];
      if (current.length) {
        list.push({ id: "current", title: null, messages: current, when: null });
      }
      for (const s of sessions) {
        list.push({ id: s.id, title: s.title, messages: s.messages, when: s.ended_at });
      }
      setChats(list);
    });
    return () => {
      active = false;
    };
  }, []);

  const whenLabel = (iso: string) =>
    new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Sofia",
    }).format(new Date(iso));

  const found = useMemo(
    () => filterRecords(filters, lang, records),
    [filters, lang, records],
  );

  const isChatTab = filters.filter === "chat";
  const chatQuery = filters.query.trim().toLocaleLowerCase();
  const visibleChats = chatQuery
    ? chats.filter((e) =>
        `${e.title || ""} ${e.messages.map((m) => m.text).join(" ")}`
          .toLocaleLowerCase()
          .includes(chatQuery),
      )
    : chats;

  const recordById = (id: string | null) => records.find((r) => r.id === id);
  const record = recordById(selected);
  if (record) {
    const isTranscript = ["call", "callback", "sms"].includes(record.type);
    const relatedTask = record.task ? recordById(record.task) : undefined;
    const relatedCall = record.call ? recordById(record.call) : undefined;
    const callTasks = records.filter((t) => t.call === record.id);
    return (
      <section
        className={`history-detail ${isTranscript ? "transcript-detail" : ""}`}
      >
        <div className="conversation-summary">
          <div className="history-meta">
            <StatusIndicator record={record} />
            <time dateTime={record.date}>{fullDate(record, lang)}</time>
          </div>
          <p className="history-summary">{record.detail?.[lang]}</p>
          {record.detail?.engine === "manus" && <TaskControls id={record.id} onUpdated={onTaskUpdated || (() => {})} />}
          {record.type === "call" ? (
            <>
              <h2>{l("От този разговор", "From this call")}</h2>
              <div className="history-list">
                <HistoryLegend />
                {callTasks.map((t) => (
                  <HistoryRow key={t.id} record={t} onSelect={onSelect} />
                ))}
              </div>
            </>
          ) : (
            <>
              {relatedTask && (
                <>
                  <h2>{l("Свързана задача", "Related task")}</h2>
                  <div className="history-list">
                    <HistoryLegend />
                    <HistoryRow record={relatedTask} onSelect={onSelect} />
                  </div>
                </>
              )}
              {relatedCall && (
                <>
                  <h2>{l("Свързан разговор", "Related call")}</h2>
                  <div className="history-list">
                    <HistoryLegend />
                    <HistoryRow record={relatedCall} onSelect={onSelect} />
                  </div>
                </>
              )}
            </>
          )}
        </div>
        {(record.type === "call" || record.type === "callback") && (
          <Transcript record={record} kind="call" />
        )}
        {record.type === "sms" && <Transcript record={record} kind="sms" />}
      </section>
    );
  }

  return (
    <section className="history-index" aria-label={l("История", "History")}>
      <HistoryToolbar
        filters={filters}
        setFilters={setFilters}
        resultCount={isChatTab ? visibleChats.length : found.length}
      />
      <div
        className="history-list"
        id="history-results"
        tabIndex={0}
        role="region"
        aria-label={isChatTab ? l("Разговори с Ало", "Alo chats") : l("Записи в историята", "History records")}
      >
        {isChatTab ? (
          visibleChats.length === 0 ? (
            <p className="history-empty">
              {l("Все още няма разговори с Ало.", "No Alo chats yet.")}
            </p>
          ) : (
            visibleChats.map((entry) => {
              const open = openChatId === entry.id;
              const title = entry.title ||
                (entry.id === "current"
                  ? l("Текущ разговор", "Current chat")
                  : l("Разговор с Ало", "Chat with Alo"));
              return (
                <div key={entry.id} className="history-chat-item">
                  <button
                    type="button"
                    className="history-chat-card"
                    aria-expanded={open}
                    onClick={() => setOpenChatId(open ? null : entry.id)}
                  >
                    <span className="history-chat-symbol">
                      <Icon name="sms" />
                    </span>
                    <span className="history-chat-copy">
                      <strong>{title}</strong>
                      <span>{entry.messages[entry.messages.length - 1]?.text}</span>
                    </span>
                    <span className="history-chat-meta">
                      <span className="history-chat-count">
                        {entry.messages.length} {l("съобщения", "messages")}
                      </span>
                      <span className="history-chat-when">
                        {entry.when ? whenLabel(entry.when) : l("в момента", "active")}
                      </span>
                    </span>
                    <Icon name="chevron" className={open ? "rotated" : ""} />
                  </button>
                  {open && (
                    <div className="transcript history-chat-transcript">
                      {entry.messages.map((m, i) => (
                        <div
                          key={i}
                          className={`transcript-turn ${m.role === "user" ? "outgoing" : "incoming"}`}
                        >
                          <p className="chat-bubble">{m.text}</p>
                          <span className="chat-caption">
                            {m.role === "user" ? l("Ти", "You") : l("Ало", "Alo")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )
        ) : (
          <>
            <HistoryLegend />
            {found.length ? (
              found.map((r) => (
                <HistoryRow key={r.id} record={r} onSelect={onSelect} />
              ))
            ) : (
              <p className="history-empty">
                {l("Няма намерени записи.", "No results found.")}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
