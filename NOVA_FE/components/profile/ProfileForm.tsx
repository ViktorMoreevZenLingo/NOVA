"use client";

import { Fragment, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Icon } from "@/components/ui/Icon";
import { Avatar } from "@/components/ui/Avatar";
import {
  PROFILE_LIMITS,
  contextPrompt,
  profileContext,
  type Profile,
} from "@/lib/profile-store";

interface ProfileFormProps {
  profile: Profile;
  submitLabel: string;
  phone?: string;
  onSave: (profile: Profile) => Promise<void>;
}

/** Word-wrapped label with <br> between words, as in the prototype. */
function WrapLabel({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((w, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {w}
        </Fragment>
      ))}
    </>
  );
}

export function ProfileForm({
  profile,
  submitLabel,
  phone,
  onSave,
}: ProfileFormProps) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const [name, setName] = useState(profile.name);
  const [notes, setNotes] = useState(profile.notes);
  const [photo, setPhoto] = useState(profile.photo);
  const [photoError, setPhotoError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [contextStatus, setContextStatus] = useState("");
  const [contextInvalid, setContextInvalid] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLTextAreaElement>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const [showFallback, setShowFallback] = useState(false);
  const photoVersion = useRef(0);

  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoError("");
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 2 * 1024 * 1024
    ) {
      setPhotoError(
        l(
          "Избери JPG, PNG или WebP снимка до 2 MB.",
          "Choose a JPG, PNG or WebP image up to 2 MB.",
        ),
      );
      e.target.value = "";
      return;
    }
    const version = ++photoVersion.current;
    setReading(true);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = resolve;
        image.onerror = reject;
        image.src = data;
      });
      if (version !== photoVersion.current) return;
      setPhoto(data);
    } catch {
      if (version === photoVersion.current)
        setPhotoError(
          l(
            "Снимката не може да бъде отворена. Избери друга.",
            "This image could not be opened. Choose another.",
          ),
        );
    } finally {
      if (version === photoVersion.current) setReading(false);
    }
  };

  const removePhoto = () => {
    photoVersion.current++;
    setReading(false);
    setPhoto("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const copyPrompt = async () => {
    const prompt = contextPrompt(lang);
    try {
      await navigator.clipboard.writeText(prompt);
      setContextStatus(l("Промптът е копиран.", "Prompt copied."));
    } catch {
      setShowFallback(true);
      if (fallbackRef.current) {
        fallbackRef.current.value = prompt;
        fallbackRef.current.focus();
        fallbackRef.current.select();
      }
      setContextStatus(
        l(
          "Копирай маркирания промпт с ⌘C или Ctrl+C.",
          "Copy the selected prompt with ⌘C or Ctrl+C.",
        ),
      );
    }
  };

  const applyContext = () => {
    const input = jsonRef.current;
    if (!input) return;
    try {
      const raw = input.value
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      let data = JSON.parse(raw);
      if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data) ||
        Object.keys(data).some(
          (k) => !["name", "notes", "city", "occupation"].includes(k),
        ) ||
        ["city", "occupation"].some(
          (k) => k in data && typeof data[k] !== "string",
        ) ||
        !["name", "notes"].every((k) => typeof data[k] === "string")
      )
        throw new Error();
      data = { name: data.name as string, notes: profileContext(data, lang) };
      const oversized = (["name", "notes"] as const).find(
        (k) => data[k].length > PROFILE_LIMITS[k],
      );
      if (oversized) {
        const max = PROFILE_LIMITS[oversized];
        setContextInvalid(true);
        setContextStatus(
          l(
            `Полето ${oversized} съдържа ${data[oversized].length.toLocaleString("bg-BG")} знака. Лимитът е ${max.toLocaleString("bg-BG")}. Текстът е запазен тук — съкрати само това поле и опитай пак.`,
            `${oversized} contains ${data[oversized].length.toLocaleString("en-GB")} characters. The limit is ${max.toLocaleString("en-GB")}. Your text is still here — shorten this field and try again.`,
          ),
        );
        return;
      }
      if (!data.name.trim() && !data.notes.trim()) {
        setContextStatus(
          l(
            "Отговорът е празен. Няма данни за добавяне.",
            "The response is empty. There is nothing to add.",
          ),
        );
        return;
      }
      if (data.name.trim()) setName(data.name.trim());
      if (data.notes.trim()) setNotes(data.notes.trim());
      setContextInvalid(false);
      setFormError("");
      setContextStatus(
        l(
          "Полетата са попълнени. Прегледай ги преди запис.",
          "Fields filled. Review them before saving.",
        ),
      );
    } catch {
      setContextInvalid(true);
      setContextStatus(
        l(
          "Постави валиден JSON с текстови полета name и notes.",
          "Paste valid JSON with string fields name and notes.",
        ),
      );
      input.focus();
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError(l("Въведи името си.", "Enter your name."));
      return;
    }
    if (reading) {
      setFormError(
        l(
          "Изчакай снимката да се зареди.",
          "Wait for the photo to finish loading.",
        ),
      );
      return;
    }
    if (saving) return;
    setSaving(true);
    setFormError("");
    try {
      await onSave({ name: trimmed, notes: notes.trim(), photo });
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : l("Записът не успя.", "Could not save."),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="profile-photo-editor">
        <div className={`photo-control${photo ? " has-photo" : ""}`}>
          <span id="avatar-preview">
            <Avatar name={name} photo={photo} large />
          </span>
          <div className="photo-actions">
            <label className="photo-picker" htmlFor="profile-photo">
              <span className="photo-picker-text">
                <WrapLabel
                  text={l(
                    photo ? "Смени снимката" : "Добави снимка",
                    photo ? "Change photo" : "Add photo",
                  )}
                />
              </span>
              <input
                id="profile-photo"
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label={l(
                  photo ? "Смени снимката" : "Добави снимка",
                  photo ? "Change photo" : "Add photo",
                )}
                onChange={onPickPhoto}
              />
            </label>
            <button
              type="button"
              className="text-button remove-photo"
              aria-label={l("Премахни снимката", "Remove photo")}
              hidden={!photo}
              onClick={removePhoto}
            >
              <WrapLabel text={l("Премахни снимката", "Remove photo")} />
            </button>
          </div>
        </div>
      </div>

      {phone && (
        <div className="profile-phone">
          <span className="profile-display-name">
            {name || l("Твоят профил", "Your profile")}
          </span>
          <strong>{phone}</strong>
        </div>
      )}

      <p id="photo-error" className="inline-error" role="alert">
        {photoError}
      </p>

      <div className="profile-field">
        <label htmlFor="profile-name">{l("Име", "Name")}</label>
        <input
          id="profile-name"
          autoComplete="name"
          maxLength={80}
          value={name}
          required
          onChange={(e) => {
            setName(e.target.value);
            setFormError("");
          }}
        />
      </div>

      <div className="profile-field">
        <label htmlFor="profile-notes">
          {l("Какво да знае NOVA AI за теб", "What should NOVA AI know about you")}
        </label>
        <textarea
          id="profile-notes"
          rows={3}
          maxLength={PROFILE_LIMITS.notes}
          value={notes}
          placeholder={l(
            "Предпочитания, навици или нещо важно за теб",
            "Preferences, routines or anything important to you",
          )}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <details className="context-import">
        <summary>
          {l(
            "Добави контекст от своя AI асистент",
            "Bring context from your AI assistant",
          )}
        </summary>
        <p>
          {l(
            "1. Копирай промпта и го постави в AI асистента, който те познава.",
            "1. Copy the prompt and paste it into the AI assistant that knows you.",
          )}
        </p>
        <button type="button" className="secondary full" onClick={copyPrompt}>
          {l("Копирай промпта", "Copy prompt")}
        </button>
        <textarea
          ref={fallbackRef}
          readOnly
          hidden={!showFallback}
          aria-label={l("Промпт за копиране", "Prompt to copy")}
        />
        <p>
          {l(
            "2. Постави JSON отговора тук. Прегледай го и премахни всичко, което не искаш да споделяш с NOVA AI.",
            "2. Paste the JSON response here. Review it and remove anything you do not want to share with NOVA AI.",
          )}
        </p>
        <label htmlFor="context-json">
          {l("Отговор от AI асистента", "AI assistant response")}
        </label>
        <textarea
          id="context-json"
          ref={jsonRef}
          rows={5}
          spellCheck={false}
          aria-invalid={contextInvalid || undefined}
          placeholder='{"name": "…", "notes": "…"}'
        />
        <p>
          {l(
            "3. Попълни полетата, прегледай ги и натисни „Запази“. Празните стойности няма да заменят твоите данни.",
            "3. Fill the fields, review them and press Save. Empty values will not replace your data.",
          )}
        </p>
        <button type="button" className="secondary full" onClick={applyContext}>
          {l("Попълни полетата", "Fill profile fields")}
        </button>
        <p id="context-status" role="status">
          {contextStatus}
        </p>
      </details>

      <p id="profile-error" className="inline-error" role="alert">
        {formError}
      </p>
      <button
        className="primary full"
        type="submit"
        disabled={saving || reading}
      >
        {submitLabel}
        <Icon name="arrow" />
      </button>
    </form>
  );
}
