// Local profile persistence, ported from the prototype's profile.js +
// profile-limits.js. Stored per phone number in localStorage; no server.

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
export function profileContext(
  value: any,
  lang: Lang = "en",
): string {
  const notes = typeof value?.notes === "string" ? value.notes : "";
  const extra: string[] = [];
  for (const [key, label] of [
    ["city", lang === "bg" ? "Град" : "City"],
    ["occupation", lang === "bg" ? "Занимание" : "Occupation"],
  ] as const) {
    const field = typeof value?.[key] === "string" ? (value[key] as string).trim() : "";
    if (field && !notes.includes(field)) extra.push(`${label}: ${field}`);
  }
  return [notes, extra.join("\n")].filter(Boolean).join("\n\n");
}

function clean(value: any, lang: Lang): Profile {
  const result = blankProfile();
  result.name =
    typeof value?.name === "string" ? value.name.slice(0, PROFILE_LIMITS.name) : "";
  result.notes = profileContext(value, lang);
  if (
    typeof value?.photo === "string" &&
    value.photo.length < 2800000 &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.photo)
  )
    result.photo = value.photo;
  return result;
}

const cache = new Map<string, Profile>();

export function loadProfile(phone: string, lang: Lang = "en"): Profile {
  if (cache.has(phone)) return { ...cache.get(phone)! };
  try {
    return clean(
      JSON.parse(localStorage.getItem(`alo:profile:${phone}`) || "null"),
      lang,
    );
  } catch {
    return blankProfile();
  }
}

export function saveProfile(phone: string, value: Profile, lang: Lang = "en"): boolean {
  const profile = clean(value, lang);
  cache.set(phone, profile);
  try {
    localStorage.setItem(`alo:profile:${phone}`, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}

export function deleteProfile(phone: string): boolean {
  try {
    localStorage.removeItem(`alo:profile:${phone}`);
    cache.delete(phone);
    return true;
  } catch {
    return false;
  }
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
