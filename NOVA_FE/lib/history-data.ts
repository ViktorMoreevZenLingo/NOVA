// Shared activity types, formatting, and filters. Records come from Supabase.

import type { Lang } from "./i18n";

export type RecordType = "call" | "callback" | "task" | "sms";
export interface Pair {
  bg: string;
  en: string;
}
export type Turn = [time: string, speaker: "alo" | "user", words: Pair];

export interface HistoryRecord {
  id: string;
  type: RecordType;
  date: string;
  status?: string;
  duration?: string;
  title: Pair;
  detail?: Pair;
  message?: Pair;
  transcript?: Turn[];
  call?: string;
  task?: string;
}

export const isComplete = (r: HistoryRecord) =>
  r.type === "call" || ["done", "sent", "notified"].includes(r.status || "");

const secondsOf = (r: HistoryRecord): number | null => {
  if (!r.duration) return null;
  const [m, s] = r.duration.split(":").map(Number);
  return m * 60 + s;
};

const dayOf = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Sofia",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

export function fullDate(r: HistoryRecord, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Sofia",
  }).format(new Date(r.date));
}

export function listDate(r: HistoryRecord, lang: Lang): string {
  const locale = lang === "bg" ? "bg-BG" : "en-GB";
  const value = new Date(r.date);
  const day = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Europe/Sofia",
  }).format(value);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Sofia",
  }).format(value);
  return `${day} · ${time}`;
}

export const shortDuration = (duration: string) => {
  const [m, s] = duration.split(":").map(Number);
  return `${m}m ${s}s`;
};

export function durationLabel(duration: string, lang: Lang): string {
  const [minutes, seconds] = duration.split(":").map(Number);
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const parts: string[] = [];
  if (minutes)
    parts.push(
      `${minutes} ${minutes === 1 ? l("минута", "minute") : l("минути", "minutes")}`,
    );
  if (seconds || !minutes)
    parts.push(
      `${seconds} ${seconds === 1 ? l("секунда", "second") : l("секунди", "seconds")}`,
    );
  return parts.join(" ");
}

export interface HistoryFilters {
  filter: string;
  query: string;
  statusFilter: string;
  period: string;
  durationFilter: string;
  sortOrder: string;
  fromDate: string;
  toDate: string;
}

export const defaultFilters = (): HistoryFilters => ({
  filter: "all",
  query: "",
  statusFilter: "all",
  period: "all",
  durationFilter: "all",
  sortOrder: "newest",
  fromDate: "",
  toDate: "",
});

export function filterRecords(
  f: HistoryFilters,
  lang: Lang,
  records: HistoryRecord[],
): HistoryRecord[] {
  const needle = f.query.trim().toLocaleLowerCase();
  const today = dayOf(new Date().toISOString());
  const past = (days: number) =>
    new Date(Date.parse(today + "T12:00:00Z") - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
  const start =
    f.period === "today"
      ? today
      : f.period === "week"
        ? past(7)
        : f.period === "month"
          ? past(30)
          : f.period === "custom"
            ? f.fromDate
            : "";
  const end =
    f.period === "custom" ? f.toDate : f.period === "all" ? "" : today;
  const statusText = (r: HistoryRecord) =>
    isComplete(r)
      ? lang === "bg"
        ? "Завършено"
        : "Complete"
      : lang === "bg"
        ? "В процес"
        : "In Progress";

  return records
    .filter((r) => {
      const sec = secondsOf(r);
      const day = dayOf(r.date);
      return (
        (f.filter === "all" || r.type === f.filter) &&
        (f.statusFilter === "all" ||
          isComplete(r) === (f.statusFilter === "complete")) &&
        (!start || day >= start) &&
        (!end || day <= end) &&
        (f.durationFilter === "all" ||
          (f.durationFilter === "short" && sec !== null && sec < 60) ||
          (f.durationFilter === "medium" &&
            sec !== null &&
            sec >= 60 &&
            sec < 300) ||
          (f.durationFilter === "long" && sec !== null && sec >= 300) ||
          (f.durationFilter === "none" && sec === null)) &&
        `${r.title[lang]} ${r.detail?.[lang] ?? ""} ${statusText(r)} ${(
          r.transcript || []
        )
          .map((turn) => turn[2][lang])
          .join(" ")}`
          .toLocaleLowerCase()
          .includes(needle)
      );
    })
    .sort((a, b) => {
      const tie = () =>
        b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
      if (f.sortOrder === "oldest")
        return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
      if (f.sortOrder === "az" || f.sortOrder === "za")
        return (
          a.title[lang].localeCompare(b.title[lang], lang) *
            (f.sortOrder === "az" ? 1 : -1) || tie()
        );
      if (f.sortOrder === "shortest" || f.sortOrder === "longest") {
        const x = secondsOf(a),
          y = secondsOf(b);
        if (x === null || y === null)
          return x === y ? tie() : x === null ? 1 : -1;
        return (x - y) * (f.sortOrder === "shortest" ? 1 : -1) || tie();
      }
      if (f.sortOrder === "status")
        return Number(isComplete(a)) - Number(isComplete(b)) || tie();
      return tie();
    });
}
