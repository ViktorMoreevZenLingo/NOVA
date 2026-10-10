"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Brand } from "@/components/ui/Brand";
import { Icon, type IconName } from "@/components/ui/Icon";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export type DashView = "dashboard" | "history" | "integrations" | "growth" | "voice" | "team" | "insights";

const COACH_TITLES: Partial<Record<DashView, string>> = { growth: "My growth", voice: "My voice", team: "My team", insights: "Insights" };

interface DashboardProps {
  view: DashView;
  firstName: string;
  /** Org role from NOVA Coach; decides whether My voice / My team / Insights are shown. */
  role?: string | null;
  breadcrumbTitle?: string | null;
  onNavigate: (view: DashView) => void;
  onBackHistory: () => void;
  onOptions: () => void;
  children: ReactNode;
}

export function Dashboard({
  view,
  firstName,
  role,
  breadcrumbTitle,
  onNavigate,
  onBackHistory,
  onOptions,
  children,
}: DashboardProps) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const navItems: { id: DashView; icon: IconName; label: string }[] = [
    { id: "dashboard", icon: "home", label: l("Начало", "Home") },
    { id: "history", icon: "history", label: l("История", "History") },
    { id: "integrations", icon: "link", label: l("Интеграции", "Integrations") },
    { id: "growth", icon: "growth", label: "My growth" },
    ...(role ? [{ id: "voice" as const, icon: "voice", label: "My voice" }] : []),
    ...(role === "manager" ? [{ id: "team" as const, icon: "team", label: "My team" }] : []),
    ...(role === "leader" || role === "hr" ? [{ id: "insights" as const, icon: "insights", label: "Insights" }] : []),
  ];

  const greeting =
    view === "dashboard"
      ? `${l("Здравей", "Hello")}${firstName ? `, ${firstName}` : ""}`
      : view === "history"
        ? l("История", "History")
        : COACH_TITLES[view] ?? l("Интеграции", "Integrations");

  const hasBreadcrumb = view === "history" && !!breadcrumbTitle;
  const contentClass =
    view === "history" ? "history-content" : view === "dashboard" ? "home-content" : view in COACH_TITLES ? "home-content coach-content" : "";

  // Back button: disabled on home, returns to the history index when viewing a
  // record, otherwise returns to home.
  const backProps =
    view === "dashboard"
      ? { disabled: true }
      : hasBreadcrumb
        ? { onClick: onBackHistory }
        : { onClick: () => onNavigate("dashboard") };

  return (
    <div className={`dashboard ${view === "history" ? "history-shell" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand label="NOVA AI" />
        </div>
        <nav aria-label={l("Основна навигация", "Main navigation")}>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              title={item.label}
              onClick={() => onNavigate(item.id)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item options-button" title={l("Опции", "Options")} onClick={onOptions}>
            <Icon name="settings" />
            <span>{l("Опции", "Options")}</span>
          </button>
        </div>
      </aside>

      <div className="dashboard-body">
        <header className="app-topbar">
          <div className="topbar-navigation">
            <button className="icon-button topbar-back" aria-label={l("Назад", "Back")} title={l("Назад", "Back")} {...backProps}>
              <Icon name="back" />
            </button>
            {hasBreadcrumb ? (
              <h1 className="history-breadcrumb" tabIndex={-1}>
                <span className="topbar-title">{l("История", "History")}</span>
                <span className="breadcrumb-detail">
                  <Icon name="chevron" />
                  <span className="breadcrumb-current" title={breadcrumbTitle || undefined}>
                    {breadcrumbTitle}
                  </span>
                </span>
              </h1>
            ) : (
              <h1 className="topbar-title" tabIndex={-1}>
                {greeting}
              </h1>
            )}
          </div>
          <LanguageSwitcher />
        </header>

        <main className={`dashboard-content ${contentClass} enter`}>{children}</main>

        <footer className="dashboard-footer">© 2026 NOVA AI</footer>
      </div>
    </div>
  );
}
