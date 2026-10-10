"use client";

import { useI18n } from "@/lib/i18n-context";
import { useAuthForm, type AuthErrorCode } from "@/hooks/useAuthForm";
import type { Dictionary } from "@/lib/i18n";

function errorText(code: AuthErrorCode, t: Dictionary): string | null {
  switch (code) {
    case "noProfile":
      return t.noProfile;
    case "alreadyExists":
      return t.alreadyExists;
    case "generic":
      return t.genericError;
    default:
      return null;
  }
}

export function AuthForm() {
  const { t } = useI18n();
  const form = useAuthForm();

  if (form.checking) {
    return <p>{t.loading}</p>;
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.submit();
  };

  return (
    <section>
      <div role="tablist" aria-label={t.appName}>
        <button
          type="button"
          role="tab"
          aria-selected={form.tab === "login"}
          onClick={() => form.setTab("login")}
        >
          {t.tabLogin}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={form.tab === "register"}
          onClick={() => form.setTab("register")}
        >
          {t.tabRegister}
        </button>
      </div>

      <h1>{form.tab === "login" ? t.headingLogin : t.headingRegister}</h1>

      <form onSubmit={onSubmit} noValidate>
        {form.tab === "register" && (
          <p>
            <label htmlFor="name">{t.nameLabel}</label>
            <br />
            <input
              id="name"
              type="text"
              value={form.name}
              onChange={(e) => form.setName(e.target.value)}
              required
            />
            {form.nameMissing && (
              <>
                <br />
                <span role="alert">{t.nameRequired}</span>
              </>
            )}
          </p>
        )}

        <p>
          <label htmlFor="phone">{t.phoneLabel}</label>
          <br />
          <span aria-hidden="true">BG +359</span>{" "}
          <input
            id="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder={t.phonePlaceholder}
            value={form.phone}
            onChange={(e) => form.setPhone(e.target.value)}
            aria-invalid={form.phoneInvalid}
            aria-describedby={form.phoneInvalid ? "phone-error" : undefined}
          />
          {form.phoneInvalid && (
            <>
              <br />
              <span id="phone-error" role="alert">
                {t.phoneInvalid}
              </span>
            </>
          )}
        </p>

        {errorText(form.errorCode, t) && (
          <p role="alert">
            {errorText(form.errorCode, t)}
            {form.offerSwitchTo && (
              <>
                {" "}
                <button type="button" onClick={form.acceptSwitch}>
                  {form.offerSwitchTo === "register"
                    ? t.switchToRegister
                    : t.switchToLogin}
                </button>
              </>
            )}
          </p>
        )}

        <p>
          <button type="submit" disabled={form.submitting}>
            {t.continue}
          </button>
        </p>
      </form>
    </section>
  );
}
