"use client";

import { useI18n } from "@/lib/i18n-context";
import { Modal } from "@/components/ui/Modal";
import { Icon } from "@/components/ui/Icon";

interface OptionsDialogProps {
  onClose: () => void;
  onEditProfile: () => void;
  onLogout: () => void;
  onDelete: () => void;
}

export function OptionsDialog({ onClose, onEditProfile, onLogout, onDelete }: OptionsDialogProps) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);
  return (
    <Modal title={l("Опции", "Options")} onClose={onClose}>
      <div className="options-list">
        <button onClick={onEditProfile}>
          <Icon name="contacts" />
          {l("Редактирай профила", "Edit Profile")}
          <Icon name="chevron" />
        </button>
        <button onClick={onLogout}>
          <Icon name="out" />
          {l("Изход", "Sign Out")}
        </button>
        <button className="danger-text" onClick={onDelete}>
          <Icon name="close" />
          {l("Изтрий профила", "Delete account")}
        </button>
      </div>
    </Modal>
  );
}
