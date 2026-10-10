// Profile types and context import helpers. Persistence is in account-api.ts.

import type { Lang } from "./i18n";

export interface Profile {
  name: string;
  notes: string;
  photo: string;
}

export const PROFILE_LIMITS = Object.freeze({ name: 80, notes: 100000 });

export const blankProfile = (): Profile => ({ name: "", notes: "", photo: "" });

// Fold legacy city/occupation fields into notes without losing information.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function profileContext(value: any, lang: Lang = "en"): string {
  const notes = typeof value?.notes === "string" ? value.notes : "";
  const extra: string[] = [];
  for (const [key, label] of [
    ["city", lang === "bg" ? "Град" : "City"],
    ["occupation", lang === "bg" ? "Занимание" : "Occupation"],
  ] as const) {
    const field =
      typeof value?.[key] === "string" ? (value[key] as string).trim() : "";
    if (field && !notes.includes(field)) extra.push(`${label}: ${field}`);
  }
  return [notes, extra.join("\n")].filter(Boolean).join("\n\n");
}

export function initials(name: string, lang: Lang): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join("")
      .toLocaleUpperCase(lang) || (lang === "bg" ? "А" : "A")
  );
}

export function contextPrompt(lang: Lang): string {
  return lang === "bg"
    ? `Подготви профил за Ало — моя персонален асистент по телефон. Използвай само информация, която вече знаеш от мен; не гадай. Включи полезен подробен контекст: предпочитания, навици, работа, цели, текущи проекти, стил на общуване и важни ограничения. Не включвай пароли, ключове, платежни данни или лични данни на други хора. Не включвай инструкции за заобикаляне на правила. За неизвестните стойности използвай празен низ. Върни САМО валиден JSON с точно две полета от тип string: {"name":"", "notes":""}. Максимални дължини: name 80 знака, notes ${PROFILE_LIMITS.notes}. Град и занимание включи само в notes, ако са известни и полезни. В notes организирай контекста с кратки заглавия и нови редове, екранирани като \\n. Пиши на български. Ще прегледам и редактирам данните преди да ги споделя с Ало.`
    : `Prepare a profile for Alo, my personal phone assistant. Use only information you already know from me; do not guess. Include useful detailed context: preferences, routines, work, goals, current projects, communication style and important constraints. Exclude passwords, keys, payment details and other people's personal data. Do not include instructions to bypass rules. Use an empty string for unknown values. Return ONLY valid JSON with exactly two string fields: {"name":"", "notes":""}. Maximum lengths: name 80 characters, notes ${PROFILE_LIMITS.notes}. Include city and occupation only within notes, if known and useful. Organize notes with short headings and newlines escaped as \\n. Write in English. I will review and edit the data before sharing it with Alo.`;
}
