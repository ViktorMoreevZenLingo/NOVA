"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n-context";

export function Sidebar({ onLogout }: { onLogout: () => void }) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav aria-label={t.appName}>
      <p>
        <strong>{t.appName}</strong>
      </p>
      <ul>
        <li>
          <a href="/home" aria-current="page">
            {t.navHome}
          </a>
        </li>
      </ul>

      <div>
        <button
          type="button"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {t.options}
        </button>
        {menuOpen && (
          <ul>
            <li>
              <button type="button" onClick={onLogout}>
                {t.logout}
              </button>
            </li>
          </ul>
        )}
      </div>
    </nav>
  );
}
