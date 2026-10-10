"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Icon } from "@/components/ui/Icon";
import type { GoogleService } from "@/lib/api";

interface ServiceRowProps {
  service: GoogleService;
  title: string;
  connected: boolean;
  onConnect: (service: GoogleService) => Promise<void>;
  onDisconnect: (service: GoogleService) => Promise<void>;
}

// Local, unmodified Google product logos (see public/assets/CREDITS.md).
const LOGO: Record<GoogleService, string> = {
  calendar: "/assets/google-calendar.svg",
  contacts: "/assets/google-contacts.png",
  gmail: "/assets/gmail.svg",
};

export function ServiceRow({
  service,
  title,
  connected,
  onConnect,
  onDisconnect,
}: ServiceRowProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (connected) {
        if (!window.confirm(t.confirmDisconnect)) {
          return;
        }
        await onDisconnect(service);
      } else {
        await onConnect(service);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="service-panel"
      onClick={handleClick}
      disabled={busy}
      aria-label={`${connected ? t.disconnect : t.connect} ${title}`}
    >
      <span className="service-icon">
        <img className="service-logo" src={LOGO[service]} alt="" width={25} height={25} />
      </span>
      <span className="panel-copy">
        <span className="panel-name">{title}</span>
        <span className="panel-status">
          {connected && <Icon name="check" />}
          {connected ? t.connected : t.notConnected}
        </span>
      </span>
      <span className="panel-action">
        {connected ? t.disconnect : t.connect}
        <Icon name="chevron" />
      </span>
    </button>
  );
}
