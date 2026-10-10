"use client";

import { useI18n } from "@/lib/i18n-context";
import { Modal } from "@/components/ui/Modal";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { formatPhone } from "@/components/auth/Auth";
import type { Profile } from "@/lib/profile-store";

interface EditProfileDialogProps {
  profile: Profile;
  phone: string;
  onClose: () => void;
  onSave: (profile: Profile) => Promise<void>;
}

export function EditProfileDialog({
  profile,
  phone,
  onClose,
  onSave,
}: EditProfileDialogProps) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);
  return (
    <Modal title={l("Профил", "Profile")} onClose={onClose}>
      <ProfileForm
        profile={profile}
        submitLabel={l("Запази", "Save")}
        phone={formatPhone(phone)}
        onSave={onSave}
      />
    </Modal>
  );
}
