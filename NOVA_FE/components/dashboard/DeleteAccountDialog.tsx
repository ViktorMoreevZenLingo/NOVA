"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Modal } from "@/components/ui/Modal";
import { formatPhone, normalizePhone } from "@/components/auth/Auth";

interface DeleteAccountDialogProps {
  phone: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export function DeleteAccountDialog({
  phone,
  onClose,
  onConfirm,
}: DeleteAccountDialogProps) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [value, setValue] = useState("");

  const matches =
    /^[+\d\s()-]+$/.test(value) &&
    normalizePhone(value) === (phone || "888123456");

  return (
    <Modal title={l("Изтрий профила", "Delete account")} onClose={onClose}>
      <p className="delete-description">
        {l(
          "Това премахва профила и контекста ти и историята ти завинаги. За потвърждение въведи номера си:",
          "This removes your profile and context and history permanently. To confirm, enter your phone number:",
        )}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!matches || busy) return;
          setBusy(true);
          setError("");
          try {
            await onConfirm();
          } catch (err) {
            setError(
              err instanceof Error ? err.message : "Could not delete account.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="delete-phone-field">
          <span className="delete-phone-hint" aria-hidden="true">
            {formatPhone(phone)}
          </span>
          <input
            id="delete-phone"
            type="tel"
            autoComplete="off"
            placeholder=" "
            aria-label={l("Мобилен номер", "Mobile number")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        <p className="form-error" role="alert">
          {error}
        </p>
        <div className="delete-actions">
          <button type="button" className="secondary" onClick={onClose}>
            {l("Отказ", "Cancel")}
          </button>
          <button
            type="submit"
            className="primary danger-button"
            disabled={!matches || busy}
          >
            {l("Изтрий профила", "Delete account")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
