"use client";

import { useI18n } from "@/lib/i18n-context";
import { Icon, type IconName } from "@/components/ui/Icon";
import {
  isComplete,
  listDate,
  shortDuration,
  type HistoryRecord,
} from "@/lib/history-data";

const TYPE_ICON: Record<HistoryRecord["type"], IconName> = {
  call: "phone",
  callback: "callback",
  task: "task",
  sms: "sms",
};

export function StatusIndicator({ record }: { record: HistoryRecord }) {
  const { lang } = useI18n();
  const complete = isComplete(record);
  const label = complete ? (lang === "bg" ? "Завършено" : "Complete") : lang === "bg" ? "В процес" : "In Progress";
  return (
    <span className={`history-status ${complete ? "complete" : "in-progress"}`} title={label}>
      <span className="history-status-label">{label}</span>
      <svg className="history-status-symbol" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        {complete ? (
          <path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth={1.8} opacity=".2" />
            <path d="M10 3a7 7 0 0 1 7 7" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
          </>
        )}
      </svg>
    </span>
  );
}

export function HistoryLegend() {
  const { lang } = useI18n();
  return (
    <div className="history-legend">
      <span>{lang === "bg" ? "Заглавие" : "Title"}</span>
      <span>{lang === "bg" ? "Статус" : "Status"}</span>
    </div>
  );
}

export function HistoryRow({ record, onSelect }: { record: HistoryRecord; onSelect: (id: string) => void }) {
  const { lang } = useI18n();
  return (
    <button className={`history-row type-${record.type}`} onClick={() => onSelect(record.id)}>
      <span className="history-symbol">
        <Icon name={TYPE_ICON[record.type]} />
      </span>
      <span className="history-copy">
        <strong>{record.title[lang]}</strong>
      </span>
      <span className="history-row-meta">
        <span className="history-chips">
          <time className="history-chip" dateTime={record.date}>
            {listDate(record, lang)}
          </time>
          {record.duration && <span className="history-chip">{shortDuration(record.duration)}</span>}
        </span>
        <StatusIndicator record={record} />
      </span>
      <Icon name="chevron" />
    </button>
  );
}
