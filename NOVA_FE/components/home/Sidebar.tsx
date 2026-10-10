"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Brand } from "@/components/ui/Brand";
import { Icon } from "@/components/ui/Icon";

export function Sidebar({ onLogout }: { onLogout: () => void }) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Close the options menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!bottomRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Brand label={t.appName} />
      </div>

      <nav aria-label={t.appName}>
        <a className="nav-item active" href="/home" aria-current="page">
          <Icon name="home" />
          <span>{t.navHome}</span>
        </a>
      </nav>

      <div className="sidebar-bottom" ref={bottomRef}>
        <button
          type="button"
          className="nav-item options-button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title={t.options}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name="settings" />
          <span>{t.options}</span>
        </button>
        {menuOpen && (
          <ul className="options-menu" role="menu">
            <li role="none">
              <button type="button" role="menuitem" onClick={onLogout}>
                <Icon name="out" />
                <span>{t.logout}</span>
              </button>
            </li>
          </ul>
        )}
      </div>
    </aside>
  );
}
