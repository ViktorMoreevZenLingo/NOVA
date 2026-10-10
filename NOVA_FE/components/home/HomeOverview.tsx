"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Icon } from "@/components/ui/Icon";
import { HistoryLegend, HistoryRow } from "@/components/history/HistoryRow";
import { type HistoryRecord } from "@/lib/history-data";
import { SERVICES, benefit, type ServiceId } from "@/lib/services";
import { ChatWindow } from "./ChatWindow";

interface HomeOverviewProps {
  records: HistoryRecord[];
  connected: Set<ServiceId>;
  phoneE164: string;
  userName: string;
  onNavigate: (view: "history" | "integrations") => void;
  onOpenRecord: (id: string) => void;
  onOpenService: (id: ServiceId) => void;
  /** NOVA Coach summary, shown under the chat. */
  coach?: ReactNode;
}

const REC_ORDER: ServiceId[] = [
  "contacts",
  "gmail",
  "calendar",
  "outlook",
  "places",
];

export function HomeOverview({
  records,
  connected,
  phoneE164,
  userName,
  onNavigate,
  onOpenRecord,
  onOpenService,
  coach,
}: HomeOverviewProps) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const recommendations = REC_ORDER.map((id) =>
    SERVICES.find((s) => s.id === id)!,
  )
    .filter((s) => !connected.has(s.id))
    .slice(0, 2);

  return (
    <section className="home-overview">
      <p className="home-description">
        {l(
          "Тук виждаш какво е свършил NOVA AI и какво предстои. Свържи услугите си, за да му дадеш повече възможности да ти помага.",
          "See what NOVA AI has done and what’s still in progress. Connect your services to give NOVA AI more ways to help you.",
        )}
      </p>

      <ChatWindow phoneE164={phoneE164} userName={userName} />

      {coach}

      <section aria-labelledby="recent-title">
        <div className="home-section-title">
          <h2 id="recent-title">
            {l("Последна активност", "Recent activity")}
          </h2>
          <button className="text-button" onClick={() => onNavigate("history")}>
            {l("Виж всички", "View all")}
            <Icon name="chevron" />
          </button>
        </div>
        <div className="history-list">
          <HistoryLegend />
          {!records.length && (
            <p className="history-empty">
              {l("Все още няма активност.", "No activity yet.")}
            </p>
          )}
          {records.slice(0, 3).map((r) => (
            <HistoryRow key={r.id} record={r} onSelect={onOpenRecord} />
          ))}
        </div>
      </section>

      <section aria-labelledby="recommended-title">
        <div className="home-section-title">
          <h2 id="recommended-title">{l("Свържи с NOVA AI", "Connect to NOVA AI")}</h2>
          <button
            className="text-button"
            onClick={() => onNavigate("integrations")}
          >
            {l("Интеграции", "Integrations")}
            <Icon name="chevron" />
          </button>
        </div>
        {recommendations.length ? (
          <div className="recommendations">
            {recommendations.map((s) => (
              <button
                key={s.id}
                className="recommendation"
                onClick={() => onOpenService(s.id)}
              >
                <span className="recommendation-icon">
                  <img
                    className={`service-logo service-logo-${s.id}`}
                    src={`/assets/${s.file}`}
                    alt=""
                    width={30}
                    height={30}
                  />
                </span>
                <span>
                  <strong>{s.name}</strong>
                  <span>{benefit(s.id, lang)}</span>
                </span>
                <span className="recommendation-action">
                  {l("Свържи", "Connect")}
                  <Icon name="chevron" />
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="connections-complete">
            <Icon name="check" />
            <span>
              {l("Всички услуги са свързани.", "All services are connected.")}
            </span>
          </div>
        )}
      </section>
    </section>
  );
}
