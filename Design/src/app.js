import { cleanupLanguageSwitcher, enhanceLanguageSwitcher } from "./language-dropdown.js";
import { homeView } from "./home.js";
import { selectHistoryRecord } from "./history.js";
import { historyView, historyBreadcrumb, bindHistory, resetHistory, cleanupHistory } from "./history.js";
import { t, getLanguage, setLanguage, translateMessage } from "./i18n.js";
import {
  blankProfile,
  loadProfile,
  saveProfile,
  deleteProfile,
  escapeHtml,
  avatar,
  profileFields,
  bindProfileForm,
} from "./profile.js";
// The existing UI is mounted after hydration inside a React-owned boundary.
export function mountAlo(app, modal) {
const lifetime = new AbortController();
resetHistory();
const paths = {
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  callback:
    '<path d="M8 3H5a2 2 0 0 0-2 2c0 8.8 7.2 16 16 16a2 2 0 0 0 2-2v-3l-5-2-2 3a13 13 0 0 1-7-7l3-2-2-5Z"/><path d="M20 3v6h-6m6 0-6-6"/>',
  task: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zm0 11 2 2 4-5"/>',
  sms: '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z"/><path d="M7 11h.01M12 11h.01M17 11h.01"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7M3 4v7h7"/><path d="M12 7v5l3 2"/>',
  settings:
    '<path d="m9 3-1 3-3 1v3l-2 2 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-2V7l-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 0 0 18 18 18 0 0 0 0-18Z"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  phone:
    '<path d="M8 3H5a2 2 0 0 0-2 2c0 8.8 7.2 16 16 16a2 2 0 0 0 2-2v-3l-5-2-2 3a13 13 0 0 1-7-7l3-2-2-5Z"/>',
  home: '<path d="m3 10 9-7 9 7v10H3V10Z"/><path d="M9 20v-7h6v7"/>',
  link: '<path d="m10 14 4-4m-6 6-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(2 1)"/>',
  calendar:
    '<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 10h16m-12 5h2m4 0h2m-8 3h2"/>',
  contacts:
    '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  gmail:
    '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 7 9-7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  out: '<path d="M10 4H4v16h6m-1-8h12m-4-4 4 4-4 4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  play: '<path d="m9 5 10 7-10 7V5Z"/>',
  sliders:
    '<path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
};
const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.phone}</svg>`;
const wave = (cls = "") =>
  `<span class="wave ${cls}" aria-hidden="true">${[12, 24, 34, 20, 10].map((h) => `<i style="--h:${h}px"></i>`).join("")}</span>`;
const brand = () =>
  `<span class="brand">${wave("brand-wave")}<span>${t("ало")}<span class="brand-dot">.</span></span></span>`;
const serviceIcon = (id) => {
  const files = {
    calendar: "google-calendar.svg",
    contacts: "google-contacts.png",
    gmail: "gmail.svg",
    places: "google-places.svg",
    outlook: "microsoft-outlook.svg",
  };
  return `<img class="service-logo service-logo-${id}" src="/assets/${files[id]}" alt="" width="28" height="28" />`;
};
const services = [
  {
    id: "places",
    name: "Google Places",
    permissions: ["Търсене на места и услуги", "Преглед на адреси, телефони и работно време"],
  },
  {
    id: "outlook",
    name: "Microsoft Outlook",
    permissions: ["Преглед на имейли и подготовка на чернови", "Преглед и създаване на срещи", "Търсене на контакти"],
  },
  {
    id: "calendar",
    name: "Google Calendar",
    permissions: [
      "Преглед на срещите",
      "Създаване на събития след потвърждение",
    ],
  },
  {
    id: "contacts",
    name: "Google Contacts",
    permissions: [
      "Търсене на контакти",
      "Преглед на телефонни номера и имейли",
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    permissions: ["Преглед на имейли", "Подготовка на чернови"],
  },
];
let state = {
  view: "login",
  mode: "login",
  phone: "",
  connected: new Set(),
  preview: false,
  profile: blankProfile(),
};
let toastTimer;
let profileEditor;
function toast(message) {
  const el = document.querySelector("#toast");
  el.textContent = t(message);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}
function navigate(view) {
  state.view = view;
  render();
  window.scrollTo(0, 0);
  app.querySelector("h1")?.focus({ preventScroll: true });
}
function formatPhone() {
  const p = state.phone || "888123456";
  return `+359 ${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`;
}
function normalizePhone(raw) {
  return raw.replace(/\D/g, "").replace(/^(00359|359|0)/, "");
}
function languageSwitcher() {
  return `<div class="language-switcher">${icon("globe")}<select id="language" aria-label="${t("Език")}"><option value="bg" ${getLanguage() === "bg" ? "selected" : ""}>BG</option><option value="en" ${getLanguage() === "en" ? "selected" : ""}>EN</option></select></div>`;
}
function previewTools() {
  return `<aside class="preview-tools" aria-label="${t("Контроли за преглед")}"><button class="preview-toggle" data-action="preview" aria-expanded="${state.preview}">${icon("sliders")}<span>${t("Преглед")}</span></button>${state.preview ? `<div class="preview-options"><div class="preview-buttons"><button data-view="login">${t("Вход")}</button><button data-view="otp">${t("Код")}</button><button data-view="dashboard">${t("Начало")}</button></div><button data-action="all-connected">${t("Всички свързани")}</button><button data-action="all-disconnected">${t("Всички несвързани")}</button></div>` : ""}</aside>`;
}
function authFrame(content, extra = "") {
  return `<div class="auth-layout"><main class="auth-main"><header class="auth-header">${brand()}</header><div class="auth-content ${extra} enter">${content}</div></main><aside class="auth-photo"><img src="/assets/phone-conversation.jpg" alt="${t("Жена, която разговаря по телефона, седнала на стълби")}" fetchpriority="high" /><p class="auth-photo-caption" lang="en">Because <em>talking</em><br>is just easier..</p></aside><footer class="auth-copyright">© ${new Date().getFullYear()} ${t("Ало")}</footer></div>`;
}
function auth() {
  const otp = state.view === "otp";
  return authFrame(`${otp ? `<button class="text-button back-button" data-view="login">${icon("back")}${t("Назад")}</button>` : `<div class="segmented" data-mode="${state.mode}" role="group" aria-label="${t("Вход или регистрация")}"><span class="segmented-highlight" aria-hidden="true"></span><button data-mode="login" aria-pressed="${state.mode === "login"}" class="${state.mode === "login" ? "selected" : ""}">${t("Вход")}</button><button data-mode="signup" aria-pressed="${state.mode === "signup"}" class="${state.mode === "signup" ? "selected" : ""}">${t("Регистрация")}</button></div>`}
  <h1 tabindex="-1">${t(otp ? "Потвърди номера" : state.mode === "login" ? "Вход в Ало" : "Създай профил")}</h1>
  ${otp ? `<p id="otp-description" class="auth-description">${t("Въведи шестцифрения код за потвърждение на")} <strong>${formatPhone()}</strong>.</p>` : ""}
  <form id="auth-form" novalidate>${otp ? `<label for="otp">${t("Код за потвърждение")}</label><div class="otp-field"><div class="otp-boxes" aria-hidden="true">${Array.from({ length: 6 }, () => "<span>–</span>").join("")}</div><input id="otp" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-describedby="otp-description form-error" aria-label="${t("Шестцифрен код за потвърждение")}" /></div>` : `<label for="phone">${t("Мобилен номер")}</label><div class="phone-field"><span class="country-prefix">BG <span>+359</span></span><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="888 123 456" value="${state.phone}" aria-describedby="form-error" /></div>`}
  <p id="form-error" class="form-error" role="alert"></p><button class="primary full" type="submit">${t(otp ? "Влез" : "Продължи")}${icon("arrow")}</button>
  ${otp ? `<button class="text-button fill-code" type="button" data-action="fill-code">${t("Попълни 123456")}</button>` : ""}</form>`);
}
function profileSetup(draft = state.profile) {
  return authFrame(
    `<h1 tabindex="-1">${t("За теб")}</h1><p class="profile-intro">${t("Можеш да промениш всичко по-късно.")}</p>${profileFields(draft, "Продължи", formatPhone())}`,
    "profile-setup",
  );
}
function profileRow() {
  return `<button class="service-panel profile-panel" data-action="edit-profile" aria-label="${t("Редактирай профила")}">${avatar(state.profile)}<span class="panel-copy"><span class="panel-name">${escapeHtml(state.profile.name || t("Твоят профил"))}</span><span class="panel-status">${t("Информация за теб")}</span></span><span class="panel-action">${t(getLanguage() === "bg" ? "Редактирай" : "Редактирай профила")}${icon("chevron")}</span></button>`;
}
function tabTitle() {
  if (state.view !== "dashboard") return t(state.view === "history" ? "История" : "Интеграции");
  const name = state.profile.name.trim().split(/\s+/)[0];
  return `${getLanguage() === "bg" ? "Здравей" : "Hello"}${name ? `, ${name}` : ""}`;
}
let lastRenderedView;
let titleTimer;
function animateHomeTitle() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const el = app.querySelector('.topbar-title-text');
  if (!el) return;
  const letters = Array.from(tabTitle());
  let position = 0;
  el.textContent = "";
  const step = () => {
    if (!el.isConnected) return;
    el.textContent = letters.slice(0, ++position).join('');
    if (position < letters.length) titleTimer = setTimeout(step, 45);
  };
  step();
}
function dashboard() {
  const breadcrumb = state.view === "history" ? historyBreadcrumb(icon) : "";
  return `<div class="dashboard ${state.view === "history" ? "history-shell" : ""}"><aside class="sidebar"><div class="sidebar-brand">${brand()}</div><nav aria-label="${t("Основна навигация")}"><button class="nav-item ${state.view === "dashboard" ? "active" : ""}" data-action="home" aria-label="${t("Начало")}" ${state.view === "dashboard" ? 'aria-current="page"' : ""} title="${t("Начало")}">${icon("home")}<span>${t("Начало")}</span></button><button class="nav-item ${state.view === "history" ? "active" : ""}" data-action="history" aria-label="${t("История")}" ${state.view === "history" ? 'aria-current="page"' : ""} title="${t("История")}">${icon("history")}<span>${t("История")}</span></button><button class="nav-item ${state.view === "integrations" ? "active" : ""}" data-action="integrations" aria-label="${t("Интеграции")}" ${state.view === "integrations" ? 'aria-current="page"' : ""} title="${t("Интеграции")}">${icon("link")}<span>${t("Интеграции")}</span></button></nav><div class="sidebar-bottom"><button class="nav-item options-button" data-action="options" aria-label="${t("Опции")}" title="${t("Опции")}">${icon("settings")}<span>${t("Опции")}</span></button></div></aside>
  <div class="dashboard-body"><header class="app-topbar"><div class="topbar-navigation"><button class="icon-button topbar-back" ${state.view === "dashboard" ? "disabled" : breadcrumb ? "data-history-back" : 'data-action="home"'} aria-label="${t("Назад")}" title="${t("Назад")}">${icon("back")}</button>${breadcrumb || `<h1 class="topbar-title" tabindex="-1" aria-label="${escapeHtml(tabTitle())}"><span class="topbar-title-text" aria-hidden="true">${escapeHtml(tabTitle())}</span></h1>`}</div>${languageSwitcher()}</header><main class="dashboard-content ${state.view === "history" ? "history-content" : state.view === "dashboard" ? "home-content" : ""} enter">${
    state.view === "history"
      ? historyView(icon)
      : state.view === "dashboard"
        ? homeView(state, services, icon, serviceIcon)
        : `<section aria-label="${t("Интеграции")}"><p class="integrations-description">${t("Добави контекст за себе си, за да може Ало да се съобразява с предпочитанията ти. Свържи контактите, пощата и календара си, за да ти помага с хората, писмата и срещите ти по телефона.")}</p><div class="services-list">${profileRow()}${[
            "contacts",
            "gmail",
            "calendar",
            "places",
            "outlook",
          ]
            .map((id) => services.find((service) => service.id === id))
            .map((s) => {
              const c = state.connected.has(s.id);
              return `<button class="service-panel ${c ? "is-connected" : ""}" data-service="${s.id}" aria-label="${t(c ? "Редактирай" : "Свържи")} ${s.name}"><span class="service-icon">${serviceIcon(s.id)}</span><span class="panel-copy"><span class="panel-name">${s.name}</span><span class="panel-status">${c ? icon("check") : ""}${t(c ? "Свързано" : "Не е свързано")}</span></span><span class="panel-action">${t(c ? "Редактирай" : "Свържи")}${icon("chevron")}</span></button>`;
            })
            .join("")}</div></section>`
  }</main><footer class="dashboard-footer">© ${new Date().getFullYear()} ${t("Ало")}</footer></div></div>`;
}
function render(draft) {
  clearTimeout(titleTimer);
  const enteringHome = state.view === "dashboard" && lastRenderedView !== "dashboard";
  lastRenderedView = state.view;
  document.documentElement.lang = getLanguage();
  document.title =
    getLanguage() === "en"
      ? "Alo — your personal assistant"
      : "Ало — личният ти асистент";
  profileEditor = undefined;
  app.innerHTML =
    (["dashboard", "history", "integrations"].includes(state.view)
      ? dashboard()
      : state.view === "profile-setup"
        ? profileSetup(draft)
        : auth()) +
    previewTools() +
    (["dashboard", "history", "integrations"].includes(state.view)
      ? ""
      : languageSwitcher());
  bind(draft);
  enhanceLanguageSwitcher();
  if (enteringHome) animateHomeTitle();
}
function switchLanguage(value) {
  if (profileEditor?.isReading()) {
    document.querySelector("#language").value = getLanguage();
    toast("Изчакай снимката да се зареди.");
    return;
  }
  const draft = profileEditor?.getDraft();
  const otp = app.querySelector("#otp")?.value;
  const messages = Array.from(app.querySelectorAll('[role="alert"]')).map(
    (el) => ({ id: el.id, text: el.textContent }),
  );
  const invalid = Array.from(app.querySelectorAll('[aria-invalid="true"]')).map(
    (el) => el.id,
  );
  const scroll = window.scrollY;
  setLanguage(value);
  render(draft);
  app.querySelectorAll(".enter").forEach((el) => el.classList.remove("enter"));
  if (otp !== undefined) {
    app.querySelector("#otp").value = otp;
    updateOtp();
  }
  messages.forEach(({ id, text }) => {
    const el = document.getElementById(id);
    if (el) el.textContent = translateMessage(text);
  });
  invalid.forEach((id) =>
    document.getElementById(id)?.setAttribute("aria-invalid", "true"),
  );
  document.querySelector("#toast").classList.remove("show");
  document.querySelector("#language").focus({ preventScroll: true });
  window.scrollTo(0, scroll);
}
function error(message, input) {
  document.querySelector("#form-error").textContent = t(message);
  input.setAttribute("aria-invalid", "true");
  input.focus();
}
function bind(draft) {
  if (state.view === "dashboard")
    app.querySelectorAll("[data-record]").forEach(
      (button) =>
        (button.onclick = () => {
          selectHistoryRecord(button.dataset.record);
          navigate("history");
        }),
    );
  if (state.view === "history") bindHistory(app, render, icon);
  document.querySelector("#language").onchange = (e) =>
    switchLanguage(e.target.value);
  if (state.view === "profile-setup")
    profileEditor = bindProfileForm(app, draft || state.profile, (profile) => {
      state.profile = profile;
      const persistent = saveProfile(state.phone, profile);
      navigate("dashboard");
      if (!persistent) toast("Промените са запазени за тази сесия.");
    });
  app
    .querySelectorAll("[data-view]")
    .forEach((b) => (b.onclick = () => navigate(b.dataset.view)));
  app.querySelectorAll("button[data-mode]").forEach(
    (button) =>
      (button.onclick = () => {
        if (state.mode === button.dataset.mode) return;
        state.mode = button.dataset.mode;
        app.querySelector(".segmented").dataset.mode = state.mode;
        app.querySelectorAll("button[data-mode]").forEach((tab) => {
          const selected = tab.dataset.mode === state.mode;
          tab.classList.toggle("selected", selected);
          tab.setAttribute("aria-pressed", String(selected));
        });
        app.querySelector(".auth-content h1").textContent = t(
          state.mode === "login" ? "Вход в Ало" : "Създай профил",
        );
      }),
  );
  app
    .querySelectorAll("[data-action]")
    .forEach((b) => (b.onclick = () => action(b.dataset.action)));
  app
    .querySelectorAll("[data-service]")
    .forEach((b) => (b.onclick = () => serviceDialog(b.dataset.service)));
  const phone = app.querySelector("#phone");
  phone?.addEventListener("input", () => {
    state.phone = phone.value.replace(/[^\d+\s()-]/g, "").slice(0, 22);
    phone.value = state.phone;
    phone.removeAttribute("aria-invalid");
    document.querySelector("#form-error").textContent = "";
  });
  const otp = app.querySelector("#otp");
  otp?.addEventListener("input", () => {
    otp.value = otp.value.replace(/\D/g, "").slice(0, 6);
    updateOtp();
    otp.removeAttribute("aria-invalid");
    document.querySelector("#form-error").textContent = "";
  });
  app.querySelector("#auth-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (state.view === "login") {
      const n = normalizePhone(phone.value);
      if (!/^[89]\d{8}$/.test(n))
        return error(
          "Въведи валиден мобилен номер, например 0888 123 456.",
          phone,
        );
      state.phone = n;
      navigate("otp");
    } else {
      if (otp.value !== "123456") return error("Използвай код 123456.", otp);
      state.profile = loadProfile(state.phone);
      navigate(state.profile.name ? "dashboard" : "profile-setup");
    }
  });
}
function updateOtp() {
  const value = app.querySelector("#otp").value;
  app.querySelectorAll(".otp-boxes span").forEach((el, i) => {
    el.textContent = value[i] || "–";
    el.classList.toggle("filled", !!value[i]);
  });
}
function action(a) {
  if (a === "preview") {
    const draft = profileEditor?.getDraft();
    const otp = app.querySelector("#otp")?.value;
    state.preview = !state.preview;
    render(draft);
    app
      .querySelectorAll(".enter")
      .forEach((el) => el.classList.remove("enter"));
    if (otp !== undefined) {
      app.querySelector("#otp").value = otp;
      updateOtp();
    }
    app.querySelector(".preview-toggle").focus();
  }
  if (a === "fill-code") {
    app.querySelector("#otp").value = "123456";
    updateOtp();
    app.querySelector("#otp").removeAttribute("aria-invalid");
    app.querySelector("#form-error").textContent = "";
    app.querySelector("#otp").focus();
  }
  if (a === "all-connected" || a === "all-disconnected") {
    state.connected = new Set(
      a === "all-connected" ? services.map((s) => s.id) : [],
    );
    navigate("dashboard");
    toast(
      a === "all-connected"
        ? "Показани са всички свързани услуги."
        : "Показани са всички несвързани услуги.",
    );
  }
  if (a === "integrations") navigate("integrations");
  if (a === "history") {
    resetHistory();
    navigate("history");
  }
  if (a === "home") {
    if (state.view !== "dashboard") navigate("dashboard");
    window.scrollTo({
      top: 0,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
    app.querySelector("h1")?.focus({ preventScroll: true });
  }
  if (a === "edit-profile") editProfile();
  if (a === "options")
    showModal(
      `<h2 id="modal-title">${t("Опции")}</h2><div class="options-list"><button id="edit-profile-option">${icon("contacts")}${t("Редактирай профила")}${icon("chevron")}</button><button id="logout">${icon("out")}${t("Изход")}</button><button id="delete-account" class="danger-text">${icon("close")}${t("Изтрий профила")}</button></div>`,
      () => {
        document.querySelector("#edit-profile-option").onclick = () => {
          modal.close();
          editProfile();
        };
        document.querySelector("#delete-account").onclick = () => {
          modal.close();
          confirmDeleteAccount();
        };
        document.querySelector("#logout").onclick = () => {
          modal.close();
          state = {
            view: "login",
            mode: "login",
            phone: "",
            connected: new Set(),
            preview: false,
            profile: blankProfile(),
          };
          navigate("login");
        };
      },
    );
}
function confirmDeleteAccount() {
  showModal(
    `<h2 id="modal-title">${t("Изтрий профила")}</h2><p class="delete-description">${t("Това премахва профила и контекста ти от този браузър. За потвърждение въведи номера си:")}</p><form id="delete-form"><div class="delete-phone-field"><span class="delete-phone-hint" aria-hidden="true">${formatPhone()}</span><input id="delete-phone" type="tel" autocomplete="off" placeholder=" " aria-label="${t("Мобилен номер")}" aria-describedby="delete-error" /></div><p id="delete-error" class="inline-error" role="alert"></p><div class="delete-actions"><button type="button" class="secondary" id="cancel-delete">${t("Отказ")}</button><button type="submit" class="primary danger-button" id="confirm-delete" disabled>${t("Изтрий профила")}</button></div></form>`,
    () => {
      const input = modal.querySelector("#delete-phone");
      const confirm = modal.querySelector("#confirm-delete");
      const matches = () =>
        /^[+\d\s()-]+$/.test(input.value) &&
        normalizePhone(input.value) === (state.phone || "888123456");
      input.oninput = () => {
        confirm.disabled = !matches();
        modal.querySelector("#delete-error").textContent = "";
      };
      modal.querySelector("#cancel-delete").onclick = () => {
        modal.close();
        action("options");
      };
      modal.querySelector("#delete-form").onsubmit = (e) => {
        e.preventDefault();
        if (!matches()) return;
        if (state.phone && !deleteProfile(state.phone)) {
          modal.querySelector("#delete-error").textContent = t(
            "Профилът не беше изтрит. Опитай отново.",
          );
          return;
        }
        modal.close();
        state = {
          view: "login",
          mode: "login",
          phone: "",
          connected: new Set(),
          preview: false,
          profile: blankProfile(),
        };
        resetHistory();
        navigate("login");
        toast("Профилът е изтрит.");
      };
    },
  );
}
function editProfile() {
  showModal(
    `<h2 id="modal-title">${t("Профил")}</h2>${profileFields(state.profile, "Запази", formatPhone())}`,
    () => {
      bindProfileForm(modal, state.profile, (profile) => {
        state.profile = profile;
        const persistent = state.phone
          ? saveProfile(state.phone, profile)
          : false;
        modal.close();
        render();
        app.querySelector('[data-action="edit-profile"]')?.focus();
        toast(
          persistent
            ? "Профилът е запазен."
            : "Промените са запазени за тази сесия.",
        );
      });
    },
  );
}
function showModal(content, setup) {
  modal.innerHTML = `<button class="modal-close icon-button" aria-label="${t("Затвори")}">${icon("close")}</button>${content}`;
  const header = document.createElement("header");
  header.className = "modal-header";
  const title = modal.querySelector("#modal-title");
  const close = modal.querySelector(".modal-close");
  const serviceLogo = modal.querySelector(".modal-icon");
  if (serviceLogo) header.append(serviceLogo);
  if (title) header.append(title);
  header.append(close);
  modal.prepend(header);
  close.onclick = () => modal.close();
  modal.showModal();
  setup?.();
}
modal.addEventListener("click", (e) => {
  if (e.target === modal) {
    const r = modal.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      modal.close();
  }
}, { signal: lifetime.signal });
function serviceDialog(id) {
  const s = services.find((s) => s.id === id),
    connected = state.connected.has(id);
  showModal(
    `<div class="modal-icon">${serviceIcon(id)}</div><h2 id="modal-title">${s.name}</h2><ul class="permissions">${s.permissions.map((p) => `<li>${icon("check")}${t(p)}</li>`).join("")}</ul><button id="connection-action" class="${connected ? "secondary" : "primary"} full">${t(connected ? "Прекъсни връзката" : "Свържи")}${icon(connected ? "out" : "chevron")}</button>`,
    () => {
      document.querySelector("#connection-action").onclick = () => {
        connected ? state.connected.delete(id) : state.connected.add(id);
        modal.close();
        render();
        (
          app.querySelector(`[data-service="${id}"]`) ||
          app.querySelector('[data-action="integrations"]')
        )?.focus();
      };
    },
  );
}
render();
return () => {
  lifetime.abort();
  clearTimeout(toastTimer);
  clearTimeout(titleTimer);
  cleanupHistory();
  cleanupLanguageSwitcher();
  document.querySelectorAll('.transcript-fullscreen').forEach(dialog => {
    dialog.close();
    dialog.remove();
  });
  document.body.classList.remove('transcript-is-fullscreen');
  modal.close();
  modal.replaceChildren();
  app.replaceChildren();
};
}
