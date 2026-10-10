// Tiny dictionary-based i18n. No library.
// Bulgarian is the default language; English is the alternative.
// Parametric strings are exposed as functions.

export type Lang = "bg" | "en";

export interface Dictionary {
  appName: string;
  continue: string;
  footer: string;

  // Auth page
  tabLogin: string;
  tabRegister: string;
  headingLogin: string;
  headingRegister: string;
  phoneLabel: string;
  phonePlaceholder: string;
  nameLabel: string;
  phoneInvalid: string;
  nameRequired: string;
  noProfile: string;
  alreadyExists: string;
  switchToRegister: string;
  switchToLogin: string;
  genericError: string;

  // Home page
  connectedServices: string;
  counter: (connected: number, total: number) => string;
  navHome: string;
  options: string;
  logout: string;
  loading: string;
  loadError: string;
  retry: string;

  // Profile row
  profileTitle: string;
  profileSubtitle: string;
  edit: string;
  save: string;
  cancel: string;
  aboutLabel: string;

  // Google service rows
  serviceCalendar: string;
  serviceContacts: string;
  serviceGmail: string;
  notConnected: string;
  connected: string;
  connect: string;
  disconnect: string;
  confirmDisconnect: string;
  connectSuccess: (service: string) => string;
  connectFailed: (message: string) => string;
}

const bg: Dictionary = {
  appName: "Ало",
  continue: "Продължи",
  footer: "© 2026 Ало",

  tabLogin: "Вход",
  tabRegister: "Регистрация",
  headingLogin: "Вход в Ало",
  headingRegister: "Регистрация в Ало",
  phoneLabel: "Мобилен номер",
  phonePlaceholder: "888 123 456",
  nameLabel: "Име",
  phoneInvalid: "Невалиден номер. Въведете 9 цифри.",
  nameRequired: "Името е задължително.",
  noProfile: "Няма профил с този номер",
  alreadyExists: "Вече има профил с този номер",
  switchToRegister: "Към регистрация",
  switchToLogin: "Към вход",
  genericError: "Нещо се обърка. Опитайте пак.",

  connectedServices: "Свързани услуги",
  counter: (c, t) => `${c} от ${t}`,
  navHome: "Начало",
  options: "Опции",
  logout: "Изход",
  loading: "Зареждане…",
  loadError: "Неуспешно зареждане.",
  retry: "Опитай пак",

  profileTitle: "Твоят профил",
  profileSubtitle: "Информация за теб",
  edit: "Редактирай",
  save: "Запази",
  cancel: "Отказ",
  aboutLabel: "За мен",

  serviceCalendar: "Google Calendar",
  serviceContacts: "Google Contacts",
  serviceGmail: "Gmail",
  notConnected: "Не е свързано",
  connected: "Свързано",
  connect: "Свържи",
  disconnect: "Прекъсни",
  confirmDisconnect: "Сигурни ли сте, че искате да прекъснете връзката?",
  connectSuccess: (service) => `${service} е свързано успешно.`,
  connectFailed: (message) => `Грешка при свързване: ${message}`,
};

const en: Dictionary = {
  appName: "Alo",
  continue: "Continue",
  footer: "© 2026 Alo",

  tabLogin: "Login",
  tabRegister: "Register",
  headingLogin: "Log in to Alo",
  headingRegister: "Register with Alo",
  phoneLabel: "Mobile number",
  phonePlaceholder: "888 123 456",
  nameLabel: "Name",
  phoneInvalid: "Invalid number. Enter 9 digits.",
  nameRequired: "Name is required.",
  noProfile: "No account with this number",
  alreadyExists: "An account with this number already exists",
  switchToRegister: "Go to registration",
  switchToLogin: "Go to login",
  genericError: "Something went wrong. Please try again.",

  connectedServices: "Connected services",
  counter: (c, t) => `${c} of ${t}`,
  navHome: "Home",
  options: "Options",
  logout: "Log out",
  loading: "Loading…",
  loadError: "Failed to load.",
  retry: "Retry",

  profileTitle: "Your profile",
  profileSubtitle: "Information about you",
  edit: "Edit",
  save: "Save",
  cancel: "Cancel",
  aboutLabel: "About me",

  serviceCalendar: "Google Calendar",
  serviceContacts: "Google Contacts",
  serviceGmail: "Gmail",
  notConnected: "Not connected",
  connected: "Connected",
  connect: "Connect",
  disconnect: "Disconnect",
  confirmDisconnect: "Are you sure you want to disconnect?",
  connectSuccess: (service) => `${service} connected successfully.`,
  connectFailed: (message) => `Connection error: ${message}`,
};

export const dictionaries: Record<Lang, Dictionary> = { bg, en };

export const DEFAULT_LANG: Lang = "bg";
export const LANG_STORAGE_KEY = "alo.lang";
