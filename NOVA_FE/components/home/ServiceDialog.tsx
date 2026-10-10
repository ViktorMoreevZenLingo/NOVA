"use client";

import { useI18n } from "@/lib/i18n-context";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/Icon";
import { serviceById, type ServiceId } from "@/lib/services";

interface ServiceDialogProps {
  id: ServiceId;
  connected: boolean;
  onClose: () => void;
  onToggle: () => void;
}

export function ServiceDialog({ id, connected, onClose, onToggle }: ServiceDialogProps) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const service = serviceById(id);
  return (
    <Modal
      title={service.name}
      icon={<img className={`service-logo service-logo-${id}`} src={`/assets/${service.file}`} alt="" width={24} height={24} />}
      onClose={onClose}
    >
      <ul className="permissions">
        {service.permissions.map((p, i) => (
          <li key={i}>
            <Icon name="check" />
            {p[lang]}
          </li>
        ))}
      </ul>
      <button className={`${connected ? "secondary" : "primary"} full`} onClick={onToggle}>
        {l(connected ? "Прекъсни връзката" : "Свържи", connected ? "Disconnect" : "Connect")}
        <Icon name={connected ? "out" : "chevron"} />
      </button>
    </Modal>
  );
}
