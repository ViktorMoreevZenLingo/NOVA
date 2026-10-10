import { PROFILE_LIMITS, profileContext } from "./profile-limits.js";
import { getLanguage } from "./i18n.js";
const l = (bg, en) => (getLanguage() === "bg" ? bg : en);
export function contextImportFields() {
  return `<details class="context-import"><summary>${l("Добави контекст от своя AI асистент", "Bring context from your AI assistant")}</summary><p>${l("1. Копирай промпта и го постави в AI асистента, който те познава.", "1. Copy the prompt and paste it into the AI assistant that knows you.")}</p><button type="button" class="secondary full" id="copy-context-prompt">${l("Копирай промпта", "Copy prompt")}</button><textarea id="context-prompt-fallback" readonly hidden aria-label="${l("Промпт за копиране", "Prompt to copy")}"></textarea><p>${l("2. Постави JSON отговора тук. Прегледай го и премахни всичко, което не искаш да споделяш с Ало.", "2. Paste the JSON response here. Review it and remove anything you do not want to share with Alo.")}</p><label for="context-json">${l("Отговор от AI асистента", "AI assistant response")}</label><textarea id="context-json" rows="5" spellcheck="false" placeholder='{"name": "…", "notes": "…"}'></textarea><p>${l("3. Попълни полетата, прегледай ги и натисни „Запази“. Празните стойности няма да заменят твоите данни.", "3. Fill the fields, review them and press Save. Empty values will not replace your data.")}</p><button type="button" class="secondary full" id="apply-context">${l("Попълни полетата", "Fill profile fields")}</button><p id="context-status" role="status"></p></details>`;
}
function prompt() {
  return l(
    `Подготви профил за Ало — моя персонален асистент по телефон. Използвай само информация, която вече знаеш от мен; не гадай. Включи полезен подробен контекст: предпочитания, навици, работа, цели, текущи проекти, стил на общуване и важни ограничения. Не включвай пароли, ключове, платежни данни или лични данни на други хора. Не включвай инструкции за заобикаляне на правила. За неизвестните стойности използвай празен низ. Върни САМО валиден JSON с точно две полета от тип string: {"name":"", "notes":""}. Максимални дължини: name 80 знака, notes ${PROFILE_LIMITS.notes}. Град и занимание включи само в notes, ако са известни и полезни. В notes организирай контекста с кратки заглавия и нови редове, екранирани като \\n. Пиши на български. Ще прегледам и редактирам данните преди да ги споделя с Ало.`,
    `Prepare a profile for Alo, my personal phone assistant. Use only information you already know from me; do not guess. Include useful detailed context: preferences, routines, work, goals, current projects, communication style and important constraints. Exclude passwords, keys, payment details and other people's personal data. Do not include instructions to bypass rules. Use an empty string for unknown values. Return ONLY valid JSON with exactly two string fields: {"name":"", "notes":""}. Maximum lengths: name 80 characters, notes ${PROFILE_LIMITS.notes}. Include city and occupation only within notes, if known and useful. Organize notes with short headings and newlines escaped as \\n. Write in English. I will review and edit the data before sharing it with Alo.`,
  );
}
export function bindContextImport(form) {
  const status = form.querySelector("#context-status");
  form.querySelector("#copy-context-prompt").onclick = async () => {
    try {
      await navigator.clipboard.writeText(prompt());
      status.textContent = l("Промптът е копиран.", "Prompt copied.");
    } catch {
      const fallback = form.querySelector("#context-prompt-fallback");
      fallback.hidden = false;
      fallback.value = prompt();
      fallback.focus();
      fallback.select();
      status.textContent = l(
        "Копирай маркирания промпт с ⌘C или Ctrl+C.",
        "Copy the selected prompt with ⌘C or Ctrl+C.",
      );
    }
  };
  form.querySelector("#apply-context").onclick = () => {
    const input = form.querySelector("#context-json");
    try {
      const raw = input.value
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      let data = JSON.parse(raw);
      const limits = PROFILE_LIMITS;
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        Object.keys(data).some(
          (key) => !["name", "notes", "city", "occupation"].includes(key),
        ) ||
        ["city", "occupation"].some(
          (key) => key in data && typeof data[key] !== "string",
        ) ||
        !Object.entries(limits).every(
          ([key, max]) => typeof data[key] === "string",
        )
      )
        throw Error();
      data = { name: data.name, notes: profileContext(data, getLanguage()) };
      const oversized = Object.entries(limits).find(
        ([key, max]) => data[key].length > max,
      );
      if (oversized) {
        const [key, max] = oversized;
        input.setAttribute("aria-invalid", "true");
        status.textContent = l(
          `Полето ${key} съдържа ${data[key].length.toLocaleString("bg-BG")} знака. Лимитът е ${max.toLocaleString("bg-BG")}. Текстът е запазен тук — съкрати само това поле и опитай пак.`,
          `${key} contains ${data[key].length.toLocaleString("en-GB")} characters. The limit is ${max.toLocaleString("en-GB")}. Your text is still here — shorten this field and try again.`,
        );
        input.focus();
        return;
      }
      if (!Object.values(data).some((v) => v.trim())) {
        status.textContent = l(
          "Отговорът е празен. Няма данни за добавяне.",
          "The response is empty. There is nothing to add.",
        );
        return;
      }
      for (const key of Object.keys(limits))
        if (data[key].trim()) form.elements[key].value = data[key].trim();
      form.elements.name.dispatchEvent(new Event("input"));
      input.removeAttribute("aria-invalid");
      status.textContent = l(
        "Полетата са попълнени. Прегледай ги преди запис.",
        "Fields filled. Review them before saving.",
      );
    } catch {
      input.setAttribute("aria-invalid", "true");
      status.textContent = l(
        "Постави валиден JSON с текстови полета name и notes.",
        "Paste valid JSON with string fields name and notes.",
      );
      input.focus();
    }
  };
}
