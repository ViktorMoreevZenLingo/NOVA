"use client";

import { useI18n } from "@/lib/i18n-context";
import { Icon } from "@/components/ui/Icon";
import type { Lang } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  return (
    <div className="language-switcher">
      <Icon name="globe" />
      <select
        aria-label="Language"
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
      >
        <option value="bg">BG</option>
        <option value="en">EN</option>
      </select>
    </div>
  );
}
