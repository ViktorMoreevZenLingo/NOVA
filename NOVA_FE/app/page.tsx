"use client";

import { useI18n } from "@/lib/i18n-context";
import { AuthForm } from "@/components/auth/AuthForm";
import { Brand } from "@/components/ui/Brand";

export default function LoginPage() {
  const { t } = useI18n();
  return (
    <div className="auth-layout">
      <main className="auth-main">
        <header className="auth-header">
          <Brand label={t.appName} />
        </header>
        <div className="auth-content enter">
          <AuthForm />
        </div>
      </main>
      <aside className="auth-photo">
        <img
          src="/assets/phone-conversation.jpg"
          alt={t.photoAlt}
          fetchPriority="high"
        />
        <p className="auth-photo-caption" lang="en">
          Because <em>talking</em>
          <br />
          is just easier..
        </p>
      </aside>
      <footer className="auth-copyright">{t.footer}</footer>
    </div>
  );
}
