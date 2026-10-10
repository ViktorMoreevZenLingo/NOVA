// Simulated call / callback / task / SMS history, ported from the prototype's
// history.js. No backend — these records are fixed sample data.

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

const pair = (bg: string, en: string): Pair => ({ bg, en });

export const RECORDS: HistoryRecord[] = [
  {
    id: "sms-1",
    type: "sms",
    date: "2026-10-10T09:44:00+03:00",
    status: "sent",
    title: pair("Ало ти изпрати телефона на Иван", "Alo sent you Ivan’s number"),
    detail: pair(
      "СМС от Ало до теб: „Телефонът на Иван Петров е 0888 123 456.“",
      "SMS from Alo to you: “Ivan Petrov’s phone number is 0888 123 456.”",
    ),
    message: pair(
      "Телефонът на Иван Петров е 0888 123 456.",
      "Ivan Petrov’s phone number is 0888 123 456.",
    ),
    call: "call-3",
    task: "task-4",
  },
  {
    id: "callback-1",
    type: "callback",
    date: "2026-10-10T09:43:00+03:00",
    status: "notified",
    duration: "0:38",
    transcript: [
      ["00:00", "alo", pair("Здравей! Обаждам се да ти кажа, че срещата с Мария е добавена в календара за понеделник, 12 октомври, от 14:00 до 14:30, в офиса.", "Hi! Your meeting with Maria is now in your calendar for Monday, October 12, from 14:00 to 14:30, at the office.")],
      ["00:14", "user", pair("Чудесно. А имейлът?", "Great. What about the email?")],
      ["00:18", "alo", pair("Черновата е готова. Чака твоето потвърждение, преди да я изпратя.", "The draft is ready. It’s waiting for your approval before I send it.")],
      ["00:28", "user", pair("Ще я прегледам. Благодаря!", "I’ll review it. Thanks!")],
      ["00:33", "alo", pair("Добре, приятен ден!", "Sounds good. Have a lovely day!")],
    ],
    title: pair("Ало ти се обади за срещата", "Alo called you about the meeting"),
    detail: pair(
      "Ало ти се обади с резултата: срещата с Мария е добавена в календара за 12 октомври, 14:00–14:30, в офиса.",
      "Alo called you with the result: your meeting with Maria was added to the calendar for October 12, 14:00–14:30, at the office.",
    ),
    call: "call-1",
    task: "task-2",
  },
  {
    id: "task-1",
    type: "task",
    date: "2026-10-10T09:42:00+03:00",
    status: "waiting",
    title: pair("Имейл до Мария", "Email to Maria"),
    detail: pair(
      "Черновата за срещата в понеделник е готова. Очаква твоето потвърждение преди изпращане.",
      "The draft for Monday’s meeting is ready. Awaiting your confirmation before sending.",
    ),
    call: "call-1",
  },
  {
    id: "task-2",
    type: "task",
    date: "2026-10-10T09:41:00+03:00",
    status: "done",
    title: pair("Среща с Мария", "Meeting with Maria"),
    detail: pair(
      "Добавена в Google Calendar за 12 октомври, 14:00–14:30. Място: офисът.",
      "Added to Google Calendar for October 12, 14:00–14:30. Location: the office.",
    ),
    call: "call-1",
  },
  {
    id: "call-1",
    type: "call",
    date: "2026-10-10T09:38:00+03:00",
    duration: "3:24",
    title: pair("Планове за понеделник", "Plans for Monday"),
    detail: pair(
      "Среща с Мария и имейл с подробностите.",
      "A meeting with Maria and an email with the details.",
    ),
    transcript: [
      ["00:00", "user", pair("Ало, запази ми среща с Мария в понеделник в два, за половин час.", "Alo, schedule a half-hour meeting with Maria on Monday at two.")],
      ["00:18", "alo", pair("На 12 октомври, от 14:00 до 14:30. Къде ще е срещата?", "October 12, from 14:00 to 14:30. Where will you meet?")],
      ["00:31", "user", pair("В офиса. Добави я в календара.", "At the office. Add it to the calendar.")],
      ["00:44", "alo", pair("Срещата е добавена. Да подготвя ли и имейл до Мария?", "The meeting is added. Shall I also draft an email to Maria?")],
      ["01:05", "user", pair("Да, напиши ѝ кога и къде, но искам да го прегледам преди да го изпратиш.", "Yes, tell her when and where, but I want to review it before you send it.")],
      ["03:12", "alo", pair("Черновата е готова и чака потвърждението ти.", "The draft is ready and waiting for your confirmation.")],
    ],
  },
  {
    id: "task-3",
    type: "task",
    date: "2026-10-09T17:16:00+03:00",
    status: "progress",
    title: pair("Час за сервиз", "Car service appointment"),
    detail: pair(
      "Търси се свободен час за вторник сутрин. Часът още не е потвърден.",
      "Looking for an available appointment on Tuesday morning. The booking is not confirmed yet.",
    ),
    call: "call-2",
  },
  {
    id: "call-2",
    type: "call",
    date: "2026-10-09T17:14:00+03:00",
    duration: "1:52",
    title: pair("Записване за сервиз", "Booking a car service"),
    detail: pair("Проверка за свободен час във вторник.", "Checking availability for Tuesday."),
    transcript: [
      ["00:00", "user", pair("Провери за час в сервиза във вторник сутрин.", "Check for a car service appointment on Tuesday morning.")],
      ["00:16", "alo", pair("В обичайния сервиз ли? Има ли час, след който не си свободен?", "At your usual garage? Is there a time after which you are unavailable?")],
      ["00:33", "user", pair("Да, в същия. Трябва да приключа до единайсет.", "Yes, the same one. I need to be done by eleven.")],
      ["01:40", "alo", pair("Ще проверя за час преди единайсет. Засега няма потвърдена резервация.", "I’ll check for an appointment before eleven. There is no confirmed booking yet.")],
    ],
  },
  {
    id: "task-4",
    type: "task",
    date: "2026-10-08T12:08:00+03:00",
    status: "done",
    title: pair("Телефонът на Иван", "Ivan’s phone number"),
    detail: pair(
      "Намерен е контактът на Иван Петров в Google Contacts.",
      "Found Ivan Petrov’s entry in Google Contacts.",
    ),
    call: "call-3",
  },
  {
    id: "call-3",
    type: "call",
    date: "2026-10-08T12:07:00+03:00",
    duration: "0:48",
    title: pair("Контакт на Иван", "Ivan’s contact"),
    detail: pair("Търсене на телефонен номер.", "Looking up a phone number."),
    transcript: [
      ["00:00", "user", pair("Намери ми телефона на Иван Петров.", "Find Ivan Petrov’s phone number.")],
      ["00:12", "alo", pair("Намерих Иван Петров в контактите ти. Да ти прочета номера?", "I found Ivan Petrov in your contacts. Shall I read out the number?")],
      ["00:23", "user", pair("Да, моля.", "Yes, please.")],
      ["00:30", "alo", pair("Номерът е нула осем осем осем, сто двайсет и три, четиристотин петдесет и шест.", "The number is zero eight eight eight, one two three, four five six.")],
    ],
  },
];

export const recordById = (id: string | null) =>
  id ? RECORDS.find((r) => r.id === id) : undefined;

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
    parts.push(`${minutes} ${minutes === 1 ? l("минута", "minute") : l("минути", "minutes")}`);
  if (seconds || !minutes)
    parts.push(`${seconds} ${seconds === 1 ? l("секунда", "second") : l("секунди", "seconds")}`);
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

export function filterRecords(f: HistoryFilters, lang: Lang): HistoryRecord[] {
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
  const end = f.period === "custom" ? f.toDate : f.period === "all" ? "" : today;
  const statusText = (r: HistoryRecord) =>
    isComplete(r) ? (lang === "bg" ? "Завършено" : "Complete") : lang === "bg" ? "В процес" : "In Progress";

  return RECORDS.filter((r) => {
    const sec = secondsOf(r);
    const day = dayOf(r.date);
    return (
      (f.filter === "all" || r.type === f.filter) &&
      (f.statusFilter === "all" || isComplete(r) === (f.statusFilter === "complete")) &&
      (!start || day >= start) &&
      (!end || day <= end) &&
      (f.durationFilter === "all" ||
        (f.durationFilter === "short" && sec !== null && sec < 60) ||
        (f.durationFilter === "medium" && sec !== null && sec >= 60 && sec < 300) ||
        (f.durationFilter === "long" && sec !== null && sec >= 300) ||
        (f.durationFilter === "none" && sec === null)) &&
      `${r.title[lang]} ${r.detail?.[lang] ?? ""} ${statusText(r)} ${(r.transcript || [])
        .map((turn) => turn[2][lang])
        .join(" ")}`
        .toLocaleLowerCase()
        .includes(needle)
    );
  }).sort((a, b) => {
    const tie = () => b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
    if (f.sortOrder === "oldest") return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
    if (f.sortOrder === "az" || f.sortOrder === "za")
      return (
        a.title[lang].localeCompare(b.title[lang], lang) * (f.sortOrder === "az" ? 1 : -1) || tie()
      );
    if (f.sortOrder === "shortest" || f.sortOrder === "longest") {
      const x = secondsOf(a),
        y = secondsOf(b);
      if (x === null || y === null) return x === y ? tie() : x === null ? 1 : -1;
      return (x - y) * (f.sortOrder === "shortest" ? 1 : -1) || tie();
    }
    if (f.sortOrder === "status") return Number(isComplete(a)) - Number(isComplete(b)) || tie();
    return tie();
  });
}

export const recentActivity = () => RECORDS.slice(0, 3);
