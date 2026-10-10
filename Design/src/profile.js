import { PROFILE_LIMITS, profileContext } from "./profile-limits.js";
import { contextImportFields, bindContextImport } from "./profile-import.js";
import { t, getLanguage } from "./i18n.js";
export const blankProfile = () => ({
  name: "",
  notes: "",
  photo: "",
});
export const escapeHtml = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const profiles = new Map();
const clean = (value) => {
  const result = blankProfile();
  for (const [key, max] of Object.entries(PROFILE_LIMITS)) {
    result[key] =
      typeof value?.[key] === "string" ? value[key].slice(0, max) : "";
  }
  result.notes = profileContext(value, getLanguage());
  if (
    typeof value?.photo === "string" &&
    value.photo.length < 2800000 &&
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.photo)
  )
    result.photo = value.photo;
  return result;
};
export function loadProfile(phone) {
  if (profiles.has(phone)) return { ...profiles.get(phone) };
  try {
    return clean(JSON.parse(localStorage.getItem(`alo:profile:${phone}`)));
  } catch {
    return blankProfile();
  }
}
export function saveProfile(phone, value) {
  const profile = clean(value);
  profiles.set(phone, profile);
  try {
    localStorage.setItem(`alo:profile:${phone}`, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}
export function deleteProfile(phone) {
  try {
    localStorage.removeItem(`alo:profile:${phone}`);
    profiles.delete(phone);
    return true;
  } catch {
    return false;
  }
}
export function avatar(profile, className = "") {
  const initials =
    profile.name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join("")
      .toLocaleUpperCase(getLanguage()) || (getLanguage() === "bg" ? "А" : "A");
  return `<span class="profile-avatar ${className}" aria-hidden="true">${profile.photo ? `<img src="${profile.photo}" alt="" />` : escapeHtml(initials)}</span>`;
}
const photoLabel = (key) => t(key).split(" ").map(escapeHtml).join("<br>");
export function profileFields(profile, submitLabel, phone = "") {
  return `<form id="profile-form" novalidate><div class="profile-photo-editor"><div class="photo-control ${profile.photo ? "has-photo" : ""}"><span id="avatar-preview">${avatar(profile, "large")}</span><div class="photo-actions"><label class="photo-picker" for="profile-photo"><span class="photo-picker-text">${photoLabel(profile.photo ? "Смени снимката" : "Добави снимка")}</span><input id="profile-photo" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="photo-error" aria-label="${t(profile.photo ? "Смени снимката" : "Добави снимка")}" /></label><button class="text-button remove-photo" type="button" aria-label="${t("Премахни снимката")}" ${profile.photo ? "" : "hidden"}>${photoLabel("Премахни снимката")}</button></div></div></div>${phone ? `<div class="profile-phone"><span class="profile-display-name">${escapeHtml(profile.name || t("Твоят профил"))}</span><strong>${escapeHtml(phone)}</strong></div>` : ""}<p id="photo-error" class="inline-error" role="alert"></p><div class="profile-field"><label for="profile-name">${t("Име")}</label><input id="profile-name" name="name" autocomplete="name" maxlength="80" value="${escapeHtml(profile.name)}" aria-describedby="profile-error" required /></div><div class="profile-field"><label for="profile-notes">${t("Какво да знае Ало за теб")}</label><textarea id="profile-notes" name="notes" maxlength="${PROFILE_LIMITS.notes}" rows="3" placeholder="${t("Предпочитания, навици или нещо важно за теб")}">${escapeHtml(profile.notes)}</textarea></div>${contextImportFields()}<p id="profile-error" class="inline-error" role="alert"></p><button class="primary full" type="submit">${t(submitLabel)}<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></form>`;
}
export function bindProfileForm(root, profile, onSave) {
  const form = root.querySelector("#profile-form");
  bindContextImport(form);
  let photo = profile.photo;
  let reading = false;
  let photoVersion = 0;
  const paint = () => {
    const displayName = form.querySelector(".profile-display-name");
    if (displayName) displayName.textContent = form.elements.name.value.trim() || t("Твоят профил");
    form.querySelector("#avatar-preview").innerHTML = avatar(
      { name: form.elements.name.value, photo },
      "large",
    );
    form.querySelector(".remove-photo").hidden = !photo;
    form.querySelector(".photo-control").classList.toggle("has-photo", !!photo);
    form.querySelector("#profile-photo").setAttribute("aria-label", t(photo ? "Смени снимката" : "Добави снимка"));
    form.querySelector(".photo-picker-text").innerHTML = photoLabel(
      photo ? "Смени снимката" : "Добави снимка",
    );
  };
  form.elements.name.addEventListener("input", () => {
    paint();
    form.querySelector("#profile-error").textContent = "";
    form.elements.name.removeAttribute("aria-invalid");
  });
  form.querySelector(".remove-photo").onclick = () => {
    photoVersion++;
    reading = false;
    photo = "";
    form.querySelector("#profile-photo").value = "";
    paint();
  };
  form.querySelector("#profile-photo").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const error = form.querySelector("#photo-error");
    error.textContent = "";
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      error.textContent = t("Избери JPG, PNG или WebP снимка до 2 MB.");
      event.target.value = "";
      return;
    }
    const version = ++photoVersion;
    reading = true;
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = reject;
        image.src = data;
      });
      if (version !== photoVersion || !form.isConnected) return;
      photo = data;
      paint();
    } catch {
      if (version === photoVersion)
        error.textContent = t(
          "Снимката не може да бъде отворена. Избери друга.",
        );
    } finally {
      if (version === photoVersion) reading = false;
    }
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    const name = form.elements.name.value.trim();
    const error = form.querySelector("#profile-error");
    if (!name) {
      error.textContent = t("Въведи името си.");
      form.elements.name.setAttribute("aria-invalid", "true");
      form.elements.name.focus();
      return;
    }
    if (reading) {
      error.textContent = t("Изчакай снимката да се зареди.");
      return;
    }
    onSave({
      name,
      notes: form.elements.notes.value.trim(),
      photo,
    });
  };
  return {
    isReading: () => reading,
    getDraft: () => ({
      name: form.elements.name.value,
      notes: form.elements.notes.value,
      photo,
    }),
  };
}
