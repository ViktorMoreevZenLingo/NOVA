"use client";

import { useI18n } from "@/lib/i18n-context";

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  return (
    <div role="group" aria-label="Language">
      <button
        type="button"
        onClick={() => setLang("bg")}
        aria-pressed={lang === "bg"}
        disabled={lang === "bg"}
      >
        BG
      </button>
      <button
        type="button"
        onClick={() => setLang("en")}
        aria-pressed={lang === "en"}
        disabled={lang === "en"}
      >
        EN
      </button>
    </div>
  );
}
