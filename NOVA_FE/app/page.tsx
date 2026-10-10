"use client";

import { useI18n } from "@/lib/i18n-context";
import { AuthForm } from "@/components/auth/AuthForm";

export default function LoginPage() {
  const { t } = useI18n();
  return (
    <main>
      <header>
        <strong>{t.appName}</strong>
      </header>
      <AuthForm />
      <footer>
        <small>{t.footer}</small>
      </footer>
    </main>
  );
}
