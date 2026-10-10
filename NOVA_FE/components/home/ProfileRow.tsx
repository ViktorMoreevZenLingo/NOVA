"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n-context";
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
      <li>
        <form onSubmit={submit}>
          <p>
            <label htmlFor="profile-name">{t.nameLabel}</label>
            <br />
            <input
              id="profile-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </p>
          <p>
            <label htmlFor="profile-about">{t.aboutLabel}</label>
            <br />
            <textarea
              id="profile-about"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
            />
          </p>
          <p>
            <button type="submit" disabled={saving}>
              {t.save}
            </button>{" "}
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              {t.cancel}
            </button>
          </p>
        </form>
      </li>
    );
  }

  return (
    <li>
      <button type="button" onClick={open}>
        <span aria-hidden="true">[{avatar}]</span>{" "}
        <span>
          <strong>{t.profileTitle}</strong> — {t.profileSubtitle}
        </span>{" "}
        <span>{t.edit}</span>
      </button>
    </li>
  );
}
