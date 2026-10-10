"use client";

import { useI18n } from "@/lib/i18n-context";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";
import { SERVICES, type ServiceId } from "@/lib/services";
import type { Profile } from "@/lib/profile-store";

interface IntegrationsProps {
  connected: Set<ServiceId>;
  profile: Profile;
  onEditProfile: () => void;
  onOpenService: (id: ServiceId) => void;
}

const ORDER: ServiceId[] = ["contacts", "gmail", "calendar", "places", "outlook"];

export function Integrations({ connected, profile, onEditProfile, onOpenService }: IntegrationsProps) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);

  return (
    <section aria-label={l("Интеграции", "Integrations")}>
      <p className="integrations-description">
        {l(
          "Добави контекст за себе си, за да може NOVA AI да се съобразява с предпочитанията ти. Свържи контактите, пощата и календара си, за да ти помага с хората, писмата и срещите ти по телефона.",
          "Add context about yourself so NOVA AI can take your preferences into account. Connect your contacts, email, and calendar to get help with the people, messages, and meetings in your day—all over the phone.",
        )}
      </p>
      <div className="services-list">
        <button className="service-panel profile-panel" onClick={onEditProfile} aria-label={l("Редактирай профила", "Edit Profile")}>
          <Avatar name={profile.name} photo={profile.photo} />
          <span className="panel-copy">
            <span className="panel-name">{profile.name || l("Твоят профил", "Your profile")}</span>
            <span className="panel-status">{l("Информация за теб", "Profile Context")}</span>
          </span>
          <span className="panel-action">
            {l("Редактирай", "Edit Profile")}
            <Icon name="chevron" />
          </span>
        </button>

        {ORDER.map((id) => SERVICES.find((s) => s.id === id)!).map((s) => {
          const c = connected.has(s.id);
          return (
            <button
              key={s.id}
              className={`service-panel${c ? " is-connected" : ""}`}
              data-service={s.id}
              onClick={() => onOpenService(s.id)}
              aria-label={`${l(c ? "Редактирай" : "Свържи", c ? "Edit" : "Connect")} ${s.name}`}
            >
              <span className="service-icon">
                <img className={`service-logo service-logo-${s.id}`} src={`/assets/${s.file}`} alt="" width={28} height={28} />
              </span>
              <span className="panel-copy">
                <span className="panel-name">{s.name}</span>
                <span className="panel-status">
                  {c && <Icon name="check" />}
                  {l(c ? "Свързано" : "Не е свързано", c ? "Connected" : "Not Connected")}
                </span>
              </span>
              <span className="panel-action">
                {l(c ? "Редактирай" : "Свържи", c ? "Edit" : "Connect")}
                <Icon name="chevron" />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
