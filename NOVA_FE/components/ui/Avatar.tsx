"use client";

import { useI18n } from "@/lib/i18n-context";
import { initials } from "@/lib/profile-store";

interface AvatarProps {
  name: string;
  photo?: string;
  large?: boolean;
}

export function Avatar({ name, photo, large }: AvatarProps) {
  const { lang } = useI18n();
  return (
    <span className={`profile-avatar${large ? " large" : ""}`} aria-hidden="true">
      {photo ? <img src={photo} alt="" /> : initials(name, lang)}
    </span>
  );
}
