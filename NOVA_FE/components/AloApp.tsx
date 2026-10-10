"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Auth, formatPhone, type AuthMode } from "@/components/auth/Auth";
import { Brand } from "@/components/ui/Brand";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { Dashboard, type DashView } from "@/components/dashboard/Dashboard";
import { HomeOverview } from "@/components/home/HomeOverview";
import { Integrations } from "@/components/home/Integrations";
import { History } from "@/components/history/History";
import { OptionsDialog } from "@/components/dashboard/OptionsDialog";
import { EditProfileDialog } from "@/components/dashboard/EditProfileDialog";
import { DeleteAccountDialog } from "@/components/dashboard/DeleteAccountDialog";
import { ServiceDialog } from "@/components/home/ServiceDialog";
import { Toast } from "@/components/ui/Toast";
import {
  blankProfile,
  deleteProfile,
  loadProfile,
  saveProfile,
  type Profile,
} from "@/lib/profile-store";
import type { ServiceId } from "@/lib/services";
import { recordById } from "@/lib/history-data";

type View = "login" | "otp" | "profile-setup" | DashView;
type Modal = "options" | "edit" | "delete" | { service: ServiceId } | null;

const CONNECTED_KEY = (phone: string) => `alo:connected:${phone}`;

export function AloApp() {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const [view, setView] = useState<View>("login");
  const [mode, setMode] = useState<AuthMode>("login");
  const [phone, setPhone] = useState("");
  const [profile, setProfile] = useState<Profile>(blankProfile());
  const [connected, setConnected] = useState<Set<ServiceId>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToast = useCallback(
    (bg: string, en: string) => {
      setToast(lang === "bg" ? bg : en);
      clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(null), 3500);
    },
    [lang],
  );

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === "en" ? "Alo — your personal assistant" : "Ало — личният ти асистент";
  }, [lang]);

  // Persist connected services per phone once we have a session.
  useEffect(() => {
    if (!phone) return;
    try {
      localStorage.setItem(CONNECTED_KEY(phone), JSON.stringify([...connected]));
    } catch {
      /* ignore */
    }
  }, [connected, phone]);

  const navigate = useCallback((next: View) => {
    if (next === "history") setSelected(null);
    setView(next);
    window.scrollTo(0, 0);
  }, []);

  const onVerified = useCallback(() => {
    const loaded = loadProfile(phone, lang);
    setProfile(loaded);
    let conn: ServiceId[] = [];
    try {
      conn = JSON.parse(localStorage.getItem(CONNECTED_KEY(phone)) || "[]");
    } catch {
      conn = [];
    }
    setConnected(new Set(conn));
    navigate(loaded.name ? "dashboard" : "profile-setup");
  }, [phone, lang, navigate]);

  const logout = useCallback(() => {
    setModal(null);
    setMode("login");
    setPhone("");
    setProfile(blankProfile());
    setConnected(new Set());
    setSelected(null);
    setView("login");
  }, []);

  const saveProfileAndClose = useCallback(
    (next: Profile, closeTo: () => void) => {
      setProfile(next);
      const persistent = phone ? saveProfile(phone, next, lang) : false;
      closeTo();
      return persistent;
    },
    [phone, lang],
  );

  const toggleService = useCallback((id: ServiceId) => {
    setConnected((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  }, []);

  // ---- Auth / profile-setup screens -------------------------------------
  if (view === "login" || view === "otp") {
    return (
      <>
        <Auth
          view={view}
          mode={mode}
          setMode={setMode}
          phone={phone}
          setPhone={setPhone}
          onPhoneSubmit={() => navigate("otp")}
          onBack={() => navigate("login")}
          onVerified={onVerified}
        />
        <Toast message={toast} />
      </>
    );
  }

  if (view === "profile-setup") {
    return (
      <>
        <div className="auth-layout">
          <main className="auth-main">
            <header className="auth-header">
              <Brand label={lang === "bg" ? "ало" : "alo"} />
            </header>
            <div className="auth-content profile-setup enter">
              <h1 tabIndex={-1}>{l("За теб", "Profile Context")}</h1>
              <p className="profile-intro">{l("Можеш да промениш всичко по-късно.", "You can change these details anytime.")}</p>
              <ProfileForm
                profile={profile}
                submitLabel={l("Продължи", "Continue")}
                phone={formatPhone(phone)}
                onSave={(next) => {
                  const persistent = saveProfileAndClose(next, () => navigate("dashboard"));
                  if (!persistent) showToast("Промените са запазени за тази сесия.", "Changes saved for this session.");
                }}
              />
            </div>
          </main>
          <aside className="auth-photo">
            <img src="/assets/phone-conversation.jpg" alt={l("Жена, която разговаря по телефона, седнала на стълби", "A woman sitting on steps talking on the phone")} />
            <p className="auth-photo-caption" lang="en">
              Because <em>talking</em>
              <br />
              is just easier..
            </p>
          </aside>
          <footer className="auth-copyright">© 2026 {lang === "bg" ? "Ало" : "Alo"}</footer>
          <LanguageSwitcher />
        </div>
        <Toast message={toast} />
      </>
    );
  }

  // ---- Dashboard shell ---------------------------------------------------
  const firstName = profile.name.trim().split(/\s+/)[0] || "";
  const breadcrumbTitle = view === "history" && selected ? recordById(selected)?.title[lang] : null;

  return (
    <>
      <Dashboard
        view={view}
        firstName={firstName}
        breadcrumbTitle={breadcrumbTitle}
        onNavigate={(v) => navigate(v)}
        onBackHistory={() => setSelected(null)}
        onOptions={() => setModal("options")}
      >
        {view === "dashboard" && (
          <HomeOverview
            connected={connected}
            phoneE164={`+359${phone}`}
            userName={profile.name}
            onNavigate={(v) => navigate(v)}
            onOpenRecord={(id) => {
              setSelected(id);
              setView("history");
              window.scrollTo(0, 0);
            }}
            onOpenService={(id) => setModal({ service: id })}
          />
        )}
        {view === "history" && <History selected={selected} onSelect={(id) => setSelected(id)} />}
        {view === "integrations" && (
          <Integrations
            connected={connected}
            profile={profile}
            onEditProfile={() => setModal("edit")}
            onOpenService={(id) => setModal({ service: id })}
          />
        )}
      </Dashboard>

      {modal === "options" && (
        <OptionsDialog
          onClose={() => setModal(null)}
          onEditProfile={() => setModal("edit")}
          onLogout={logout}
          onDelete={() => setModal("delete")}
        />
      )}

      {modal === "edit" && (
        <EditProfileDialog
          profile={profile}
          phone={phone}
          onClose={() => setModal(null)}
          onSave={(next) => {
            const persistent = saveProfileAndClose(next, () => setModal(null));
            showToast(
              persistent ? "Профилът е запазен." : "Промените са запазени за тази сесия.",
              persistent ? "Profile saved." : "Changes saved for this session.",
            );
          }}
        />
      )}

      {modal === "delete" && (
        <DeleteAccountDialog
          phone={phone}
          onClose={() => setModal("options")}
          onConfirm={() => {
            if (phone) deleteProfile(phone);
            logout();
            showToast("Профилът е изтрит.", "Account deleted.");
          }}
        />
      )}

      {modal && typeof modal === "object" && "service" in modal && (
        <ServiceDialog
          id={modal.service}
          connected={connected.has(modal.service)}
          onClose={() => setModal(null)}
          onToggle={() => {
            toggleService(modal.service);
            setModal(null);
          }}
        />
      )}

      <Toast message={toast} />
    </>
  );
}
