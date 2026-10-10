"use client";

import { useI18n } from "@/lib/i18n-context";
import { useHome, type Notice } from "@/hooks/useHome";
import type { Dictionary } from "@/lib/i18n";
import type { GoogleService } from "@/lib/api";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
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
    <main>
      <Sidebar onLogout={() => void home.logout()} />

      <div>
        <header>
          <LanguageSwitcher />
        </header>

        {home.loading && <p>{t.loading}</p>}

        {home.loadError && (
          <p role="alert">
            {t.loadError}{" "}
            <button type="button" onClick={home.retry}>
              {t.retry}
            </button>
          </p>
        )}

        {!home.loading && !home.loadError && home.me && (
          <section>
            <h1>
              {t.connectedServices}{" "}
              <span>{t.counter(home.connectedCount, 3)}</span>
            </h1>

            {home.notice && (
              <p role="status">
                {noticeText(home.notice, t)}{" "}
                <button type="button" onClick={home.dismissNotice}>
                  ×
                </button>
              </p>
            )}

            <ul>
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
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
