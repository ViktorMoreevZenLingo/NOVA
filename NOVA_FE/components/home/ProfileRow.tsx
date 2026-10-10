"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Icon } from "@/components/ui/Icon";
import type { Me, UpdateMeInput } from "@/lib/api";

interface ProfileRowProps {
  me: Me;
  onSave: (input: UpdateMeInput) => Promise<void>;
}

export function ProfileRow({ me, onSave }: ProfileRowProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me.name);
  const [about, setAbout] = useState(me.about);
  const [saving, setSaving] = useState(false);

  const open = () => {
    setName(me.name);
    setAbout(me.about);
    setEditing(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ name: name.trim(), about: about.trim() });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const avatar = (me.name.trim()[0] ?? "?").toUpperCase();

  if (editing) {
    return (
      <form className="profile-edit" onSubmit={submit}>
        <div className="profile-field">
          <label htmlFor="profile-name">{t.nameLabel}</label>
          <input
            id="profile-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="profile-field">
          <label htmlFor="profile-about">{t.aboutLabel}</label>
          <textarea
            id="profile-about"
            value={about}
            onChange={(e) => setAbout(e.target.value)}
          />
        </div>
        <div className="profile-actions">
          <button type="submit" className="primary" disabled={saving}>
            {t.save}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            {t.cancel}
          </button>
        </div>
      </form>
    );
  }

  return (
    <button
      type="button"
      className="service-panel profile-panel"
      onClick={open}
      aria-label={t.edit}
    >
      <span className="profile-avatar" aria-hidden="true">
        {avatar}
      </span>
      <span className="panel-copy">
        <span className="panel-name">{me.name.trim() || t.profileTitle}</span>
        <span className="panel-status">{t.profileSubtitle}</span>
      </span>
      <span className="panel-action">
        {t.edit}
        <Icon name="chevron" />
      </span>
    </button>
  );
}
