"use client";

import { useI18n } from "@/lib/i18n-context";
import { useHome, type Notice } from "@/hooks/useHome";
import type { Dictionary } from "@/lib/i18n";
import type { GoogleService } from "@/lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Icon } from "@/components/ui/Icon";
import { Sidebar } from "./Sidebar";
import { ProfileRow } from "./ProfileRow";
import { ServiceRow } from "./ServiceRow";

const GOOGLE_SERVICES: { service: GoogleService; titleKey: keyof Dictionary }[] =
  [
    { service: "calendar", titleKey: "serviceCalendar" },
    { service: "contacts", titleKey: "serviceContacts" },
    { service: "gmail", titleKey: "serviceGmail" },
  ];

function noticeText(notice: Notice, t: Dictionary): string | null {
  if (!notice) return null;
  if (notice.kind === "success") {
    const title = {
      calendar: t.serviceCalendar,
      contacts: t.serviceContacts,
      gmail: t.serviceGmail,
    }[notice.service];
    return t.connectSuccess(title);
  }
  return t.connectFailed(notice.message);
}

export function HomeView() {
  const { t } = useI18n();
  const home = useHome();

  return (
    <div className="dashboard">
      <Sidebar onLogout={() => void home.logout()} />

      <div className="dashboard-body">
        <LanguageSwitcher />

        <main className="dashboard-content enter">
          {home.loading && <p className="load-state">{t.loading}</p>}

          {home.loadError && (
            <p className="load-error" role="alert">
              {t.loadError}{" "}
              <button
                type="button"
                className="secondary"
                onClick={home.retry}
              >
                {t.retry}
              </button>
            </p>
          )}

          {!home.loading && !home.loadError && home.me && (
            <section aria-label={t.connectedServices}>
              <div className="section-heading">
                <h1>{t.connectedServices}</h1>
                <span className="service-count">
                  {t.counter(home.connectedCount, 3)}
                </span>
              </div>

              {home.notice && (
                <p
                  className={`notice${
                    home.notice.kind === "error" ? " error" : ""
                  }`}
                  role="status"
                >
                  {noticeText(home.notice, t)}
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t.cancel}
                    onClick={home.dismissNotice}
                  >
                    <Icon name="close" />
                  </button>
                </p>
              )}

              <div className="services-list">
                <ProfileRow me={home.me} onSave={home.saveProfile} />
                {GOOGLE_SERVICES.map(({ service, titleKey }) => (
                  <ServiceRow
                    key={service}
                    service={service}
                    title={t[titleKey] as string}
                    connected={home.me!.services[service]}
                    onConnect={home.connect}
                    onDisconnect={home.disconnect}
                  />
                ))}
              </div>
            </section>
          )}
        </main>

        <footer className="dashboard-footer">{t.footer}</footer>
      </div>
    </div>
  );
}
