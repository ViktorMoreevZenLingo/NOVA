"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import type { GoogleService } from "@/lib/api";

interface ServiceRowProps {
  service: GoogleService;
  title: string;
  connected: boolean;
  onConnect: (service: GoogleService) => Promise<void>;
  onDisconnect: (service: GoogleService) => Promise<void>;
}

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
    <li>
      <button type="button" onClick={handleClick} disabled={busy}>
        <span aria-hidden="true">[G]</span>{" "}
        <span>
          <strong>{title}</strong>
        </span>{" "}
        <span>{connected ? t.connected : t.notConnected}</span>{" "}
        <span>{connected ? t.disconnect : t.connect}</span>
      </button>
    </li>
  );
}
