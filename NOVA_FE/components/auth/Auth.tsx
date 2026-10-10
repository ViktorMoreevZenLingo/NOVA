"use client";

import { useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Brand } from "@/components/ui/Brand";
import { Icon } from "@/components/ui/Icon";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export type AuthMode = "login" | "signup";

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^(00359|359|0)/, "");
}

export function formatPhone(phone: string): string {
  const p = phone || "888123456";
  return `+359 ${p.slice(0, 3)} ${p.slice(3, 6)} ${p.slice(6)}`;
}

function AuthFrame({
  extra,
  children,
}: {
  extra?: string;
  children: ReactNode;
}) {
  const { lang } = useI18n();
  return (
    <div className="auth-layout">
      <main className="auth-main">
        <header className="auth-header">
          <Brand label={lang === "bg" ? "ало" : "alo"} />
        </header>
        <div className={`auth-content ${extra ?? ""} enter`}>{children}</div>
      </main>
      <aside className="auth-photo">
        <img
          src="/assets/phone-conversation.jpg"
          alt={
            lang === "bg"
              ? "Жена, която разговаря по телефона, седнала на стълби"
              : "A woman sitting on steps talking on the phone"
          }
          fetchPriority="high"
        />
        <p className="auth-photo-caption" lang="en">
          Because <em>talking</em>
          <br />
          is just easier..
        </p>
      </aside>
      <footer className="auth-copyright">
        © 2026 {lang === "bg" ? "Ало" : "Alo"}
      </footer>
      <LanguageSwitcher />
    </div>
  );
}

interface AuthProps {
  view: "login" | "otp";
  mode: AuthMode;
  setMode: (m: AuthMode) => void;
  phone: string;
  setPhone: (p: string) => void;
  onPhoneSubmit: (phone: string) => Promise<void>;
  onBack: () => void;
  onVerified: (otp: string) => Promise<void>;
}

export function Auth({
  view,
  mode,
  setMode,
  phone,
  setPhone,
  onPhoneSubmit,
  onBack,
  onVerified,
}: AuthProps) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const [error, setError] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);

  if (view === "otp") {
    const submitOtp = async (e: React.FormEvent) => {
      e.preventDefault();
      if (busy) return;
      if (!/^\d{6}$/.test(otp)) {
        setError(l("Въведи шестцифрения код.", "Enter the six-digit code."));
        return;
      }
      setBusy(true);
      setError("");
      try {
        await onVerified(otp);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : l("Опитай отново.", "Please try again."),
        );
      } finally {
        setBusy(false);
      }
    };
    return (
      <AuthFrame>
        <button
          type="button"
          className="text-button back-button"
          disabled={busy}
          onClick={() => {
            setOtp("");
            setError("");
            onBack();
          }}
        >
          <Icon name="back" />
          {l("Назад", "Back")}
        </button>
        <h1 tabIndex={-1}>{l("Потвърди номера", "Confirm your number")}</h1>
        <p id="otp-description" className="auth-description">
          {l(
            "Въведи шестцифрения код за потвърждение на",
            "Enter the six-digit verification code for",
          )}{" "}
          <strong>{formatPhone(phone)}</strong>.
        </p>
        <form onSubmit={submitOtp} noValidate>
          <label htmlFor="otp">
            {l("Код за потвърждение", "Verification code")}
          </label>
          <div className="otp-field">
            <div className="otp-boxes" aria-hidden="true">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} className={otp[i] ? "filled" : ""}>
                  {otp[i] || "–"}
                </span>
              ))}
            </div>
            <input
              id="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              aria-label={l(
                "Шестцифрен код за потвърждение",
                "Six-digit verification code",
              )}
              onChange={(e) => {
                setOtp(e.target.value.replace(/\D/g, "").slice(0, 6));
                setError("");
              }}
            />
          </div>
          <p id="form-error" className="form-error" role="alert">
            {error}
          </p>
          <button className="primary full" type="submit" disabled={busy}>
            {l("Влез", "Sign In")}
            <Icon name="arrow" />
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onPhoneSubmit(phone);
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Please try again.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {l("Изпрати нов код", "Resend code")}
          </button>
        </form>
      </AuthFrame>
    );
  }

  const submitPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = normalizePhone(phone);
    if (!/^[89]\d{8}$/.test(n)) {
      setError(
        l(
          "Въведи валиден мобилен номер, например 0888 123 456.",
          "Enter a valid Bulgarian mobile number, e.g. 0888 123 456.",
        ),
      );
      return;
    }
    setPhone(n);
    setError("");
    if (busy) return;
    setBusy(true);
    try {
      await onPhoneSubmit(n);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <div
        className="segmented"
        data-mode={mode}
        role="group"
        aria-label={l("Вход или регистрация", "Sign in or sign up")}
      >
        <span className="segmented-highlight" aria-hidden="true" />
        <button
          type="button"
          data-mode="login"
          aria-pressed={mode === "login"}
          className={mode === "login" ? "selected" : ""}
          onClick={() => {
            setMode("login");
            setError("");
          }}
        >
          {l("Вход", "Sign In")}
        </button>
        <button
          type="button"
          data-mode="signup"
          aria-pressed={mode === "signup"}
          className={mode === "signup" ? "selected" : ""}
          onClick={() => {
            setMode("signup");
            setError("");
          }}
        >
          {l("Регистрация", "Sign Up")}
        </button>
      </div>
      <h1 tabIndex={-1}>
        {mode === "login"
          ? l("Вход в Ало", "Sign in to Alo")
          : l("Създай профил", "Create an account")}
      </h1>
      <form onSubmit={submitPhone} noValidate>
        <label htmlFor="phone">{l("Мобилен номер", "Mobile number")}</label>
        <div className="phone-field">
          <span className="country-prefix">
            BG <span>+359</span>
          </span>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="888 123 456"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value.replace(/[^\d+\s()-]/g, "").slice(0, 22));
              setError("");
            }}
          />
        </div>
        <p id="form-error" className="form-error" role="alert">
          {error}
        </p>
        <button className="primary full" type="submit" disabled={busy}>
          {l("Продължи", "Continue")}
          <Icon name="arrow" />
        </button>
      </form>
    </AuthFrame>
  );
}
