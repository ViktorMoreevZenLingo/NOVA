import type { Args } from "./contracts.ts";
import { validateArgs } from "./validation.ts";
/** Resolve named calendar periods at acceptance, not later when scheduled work starts. */
export function calendarRange(
  args: Args,
  instruction: string,
  timezone = "Europe/Sofia",
  now = new Date(),
): Args {
  if (args.from || args.to) {
    return validateArgs("list_calendar_events", {
      from: args.from ?? args.to,
      to: args.to ?? args.from,
      max: 25,
    });
  }
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const base = new Date(`${today}T12:00:00Z`);
  const date = (days: number) =>
    new Date(base.getTime() + days * 86400000).toISOString().slice(0, 10);
  const weekday = base.getUTCDay();
  if (/next week|следващ(?:ата|а) седмица/i.test(instruction)) {
    const monday = (8 - weekday) % 7 || 7;
    return { from: date(monday), to: date(monday + 6), max: 25 };
  }
  if (/this week|тази седмица|текущата седмица/i.test(instruction)) {
    const monday = -((weekday + 6) % 7);
    return { from: date(monday), to: date(monday + 6), max: 25 };
  }
  if (/tomorrow|утре/i.test(instruction)) {
    return { from: date(1), to: date(1), max: 25 };
  }
  if (/today|днес/i.test(instruction)) {
    return { from: date(0), to: date(0), max: 25 };
  }
  // For other named dates the voice agent must supply from/to; don't guess them.
  return validateArgs("list_calendar_events", {
    days_ahead: args.days_ahead ?? 7,
    max: 25,
  });
}
