"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import {
  defaultFilters,
  filterRecords,
  fullDate,
  type HistoryRecord,
} from "@/lib/history-data";
import { HistoryLegend, HistoryRow, StatusIndicator } from "./HistoryRow";
import { HistoryToolbar } from "./HistoryToolbar";
import { Transcript } from "./Transcript";

interface HistoryProps {
  records: HistoryRecord[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

export function History({ records, selected, onSelect }: HistoryProps) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const [filters, setFilters] = useState(defaultFilters());

  const found = useMemo(
    () => filterRecords(filters, lang, records),
    [filters, lang, records],
  );

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
        resultCount={found.length}
      />
      <div
        className="history-list"
        id="history-results"
        tabIndex={0}
        role="region"
        aria-label={l("Записи в историята", "History records")}
      >
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
      </div>
    </section>
  );
}
