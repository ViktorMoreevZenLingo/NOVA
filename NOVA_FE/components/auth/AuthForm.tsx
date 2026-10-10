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
    return <p className="load-state">{t.loading}</p>;
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.submit();
  };

  const topError = errorText(form.errorCode, t);

  return (
    <section>
      <div
        className="segmented"
        data-mode={form.tab}
        role="group"
        aria-label={t.appName}
      >
        <span className="segmented-highlight" aria-hidden="true" />
        <button
          type="button"
          aria-pressed={form.tab === "login"}
          className={form.tab === "login" ? "selected" : ""}
          onClick={() => form.setTab("login")}
        >
          {t.tabLogin}
        </button>
        <button
          type="button"
          aria-pressed={form.tab === "register"}
          className={form.tab === "register" ? "selected" : ""}
          onClick={() => form.setTab("register")}
        >
          {t.tabRegister}
        </button>
      </div>

      <h1>{form.tab === "login" ? t.headingLogin : t.headingRegister}</h1>

      <form onSubmit={onSubmit} noValidate>
        {form.tab === "register" && (
          <div className="profile-field">
            <label htmlFor="name">{t.nameLabel}</label>
            <input
              id="name"
              type="text"
              value={form.name}
              onChange={(e) => form.setName(e.target.value)}
              required
            />
            {form.nameMissing && (
              <p className="form-error" role="alert">
                {t.nameRequired}
              </p>
            )}
          </div>
        )}

        <div className="profile-field">
          <label htmlFor="phone">{t.phoneLabel}</label>
          <div className="phone-field" data-invalid={form.phoneInvalid}>
            <span className="country-prefix" aria-hidden="true">
              BG <span>+359</span>
            </span>
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
          </div>
          {form.phoneInvalid && (
            <p id="phone-error" className="form-error" role="alert">
              {t.phoneInvalid}
            </p>
          )}
        </div>

        {topError && (
          <p className="form-error" role="alert">
            {topError}
            {form.offerSwitchTo && (
              <>
                {" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={form.acceptSwitch}
                >
                  {form.offerSwitchTo === "register"
                    ? t.switchToRegister
                    : t.switchToLogin}
                </button>
              </>
            )}
          </p>
        )}

        <button
          type="submit"
          className="primary full fill-code"
          disabled={form.submitting}
        >
          {t.continue}
        </button>
      </form>
    </section>
  );
}
