// The five integrations shown on the Integrations screen and in recommendations.
// calendar/contacts/gmail are backed by the real Spring Boot service in
// production; places/outlook are simulated client-side for now.

import type { Lang } from "./i18n";

export type ServiceId =
  | "contacts"
  | "gmail"
  | "calendar"
  | "places"
  | "outlook";

export interface ServiceDef {
  id: ServiceId;
  name: string;
  /** Permission lines shown in the connection dialog (bilingual). */
  permissions: { bg: string; en: string }[];
  file: string;
}

export const SERVICES: ServiceDef[] = [
  {
    id: "places",
    name: "Google Places",
    file: "google-places.svg",
    permissions: [
      { bg: "Търсене на места и услуги", en: "Find places and local services" },
      {
        bg: "Преглед на адреси, телефони и работно време",
        en: "View addresses, phone numbers, and opening hours",
      },
    ],
  },
  {
    id: "outlook",
    name: "Microsoft Outlook",
    file: "microsoft-outlook.svg",
    permissions: [
      {
        bg: "Преглед на имейли и подготовка на чернови",
        en: "Read emails and prepare drafts",
      },
      {
        bg: "Преглед и създаване на срещи",
        en: "View and create calendar events",
      },
      { bg: "Търсене на контакти", en: "Find contacts" },
    ],
  },
  {
    id: "calendar",
    name: "Google Calendar",
    file: "google-calendar.svg",
    permissions: [
      { bg: "Преглед на срещите", en: "View calendar events" },
      {
        bg: "Създаване на събития след потвърждение",
        en: "Create events after confirmation",
      },
    ],
  },
  {
    id: "contacts",
    name: "Google Contacts",
    file: "google-contacts.png",
    permissions: [
      { bg: "Търсене на контакти", en: "Find contacts" },
      {
        bg: "Преглед на телефонни номера и имейли",
        en: "View phone numbers and email addresses",
      },
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    file: "gmail.svg",
    permissions: [
      { bg: "Преглед на имейли", en: "Read emails" },
      { bg: "Подготовка на чернови", en: "Prepare drafts" },
    ],
  },
];

export function serviceById(id: ServiceId): ServiceDef {
  return SERVICES.find((s) => s.id === id)!;
}

export const benefit = (id: ServiceId, lang: Lang): string =>
  ({
    places: {
      bg: "Намирай места, адреси и работно време.",
      en: "Find places, addresses, and opening hours.",
    },
    outlook: {
      bg: "Пощата, срещите и контактите ти в Outlook.",
      en: "Your Outlook email, meetings, and contacts.",
    },
    calendar: {
      bg: "Срещите ти, подредени с едно обаждане.",
      en: "Manage your schedule with a phone call.",
    },
    contacts: {
      bg: "Намирай хората си по име.",
      en: "Find your contacts by name.",
    },
    gmail: {
      bg: "Преглеждай писма и подготвяй отговори.",
      en: "Catch up on email and prepare replies.",
    },
  })[id][lang];
