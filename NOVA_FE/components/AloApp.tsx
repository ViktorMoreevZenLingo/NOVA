"use client";

import { useEffect, useRef, useState } from "react";
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
import {
  ensureSession,
  getMe,
  disconnectGoogle,
  googleConnectUrl,
  type GoogleService,
  type MeServices,
} from "@/lib/agent-api";

type View = "login" | "otp" | "profile-setup" | DashView;
type Modal = "options" | "edit" | "delete" | { service: ServiceId } | null;

const CONNECTED_KEY = (phone: string) => `alo:connected:${phone}`;
const SESSION_KEY = "alo:session";
const GOOGLE: ServiceId[] = ["calendar", "contacts", "gmail"];
const NO_SERVICES: MeServices = { calendar: false, contacts: false, gmail: false };

export function AloApp() {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const [view, setView] = useState<View>("login");
  const [mode, setMode] = useState<AuthMode>("login");
  const [phone, setPhone] = useState("");
  const [profile, setProfile] = useState<Profile>(blankProfile());
  // Simulated connections (Places / Outlook — no backend yet).
  const [simConnected, setSimConnected] = useState<Set<ServiceId>>(new Set());
  // Real Google connection state, from the backend (/api/me).
  const [googleServices, setGoogleServices] = useState<MeServices>(NO_SERVICES);
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const phoneE164 = `+359${phone}`;

  const showToast = (bg: string, en: string) => {
    setToast(lang === "bg" ? bg : en);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = lang === "en" ? "Alo — your personal assistant" : "Ало — личният ти асистент";
  }, [lang]);

  // Persist simulated connections per phone once we have a session.
  useEffect(() => {
    if (!phone) return;
    try {
      localStorage.setItem(CONNECTED_KEY(phone), JSON.stringify([...simConnected]));
    } catch {
      /* ignore */
    }
  }, [simConnected, phone]);

  // Establish a backend session and pull real Google state + profile. Throws if
  // the backend is unreachable so callers can fall back to local-only.
  const loadGoogle = async (e164: string, name: string) => {
    await ensureSession(e164, name);
    const me = await getMe();
    setGoogleServices(me.services);
    return me;
  };

  // Resume an existing session after a reload or the OAuth round-trip, and
  // surface the ?connected= / ?error= the Google callback redirects back with.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    let connectedParam: string | null = null;
    let errorParam: string | null = null;
    let stored: string | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      connectedParam = params.get("connected");
      errorParam = params.get("error");
      stored = sessionStorage.getItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    if (stored) {
      const prof = loadProfile(stored, lang);
      setPhone(stored);
      setProfile(prof);
      try {
        setSimConnected(new Set(JSON.parse(localStorage.getItem(CONNECTED_KEY(stored)) || "[]")));
      } catch {
        /* ignore */
      }
      setView(connectedParam || errorParam ? "integrations" : "dashboard");
      loadGoogle(`+359${stored}`, prof.name)
        .then((me) => {
          if (!prof.name && me.name) setProfile((p) => ({ ...p, name: me.name, notes: p.notes || me.about || "" }));
        })
        .catch(() => {});
      if (connectedParam) showToast(`${connectedParam} е свързано успешно.`, `${connectedParam} connected successfully.`);
      else if (errorParam) showToast(`Грешка при свързване: ${errorParam}`, `Connection error: ${errorParam}`);
    }
    if (connectedParam || errorParam) {
      try {
        window.history.replaceState(null, "", window.location.pathname);
      } catch {
        /* ignore */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = (next: View) => {
    if (next === "history") setSelected(null);
    setView(next);
    window.scrollTo(0, 0);
  };

  const onVerified = async () => {
    const local = loadProfile(phone, lang);
    try {
      setSimConnected(new Set(JSON.parse(localStorage.getItem(CONNECTED_KEY(phone)) || "[]")));
    } catch {
      setSimConnected(new Set());
    }
    try {
      sessionStorage.setItem(SESSION_KEY, phone);
    } catch {
      /* ignore */
    }
    // Pull the real profile/state from the backend; if it knows a name the local
    // store doesn't, adopt it so a known user skips profile setup.
    let merged = local;
    try {
      const me = await loadGoogle(phoneE164, local.name);
      if (!local.name && me.name) {
        merged = { ...local, name: me.name, notes: local.notes || me.about || "" };
        saveProfile(phone, merged, lang);
      }
    } catch {
      // Backend unavailable — continue with the local profile only.
    }
    setProfile(merged);
    navigate(merged.name ? "dashboard" : "profile-setup");
  };

  const logout = () => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
    setModal(null);
    setMode("login");
    setPhone("");
    setProfile(blankProfile());
    setSimConnected(new Set());
    setGoogleServices(NO_SERVICES);
    setSelected(null);
    setView("login");
  };

  const saveProfileAndClose = (next: Profile, closeTo: () => void): boolean => {
    setProfile(next);
    const persistent = phone ? saveProfile(phone, next, lang) : false;
    closeTo();
    return persistent;
  };

  // Combined connection state for the UI: real Google + simulated others.
  const connectedSet = new Set<ServiceId>();
  (GOOGLE as GoogleService[]).forEach((s) => {
    if (googleServices[s]) connectedSet.add(s);
  });
  (["places", "outlook"] as ServiceId[]).forEach((s) => {
    if (simConnected.has(s)) connectedSet.add(s);
  });

  const onServiceAction = async (id: ServiceId) => {
    const nowConnected = connectedSet.has(id);
    if (GOOGLE.includes(id)) {
      if (nowConnected) {
        setModal(null);
        try {
          await ensureSession(phoneE164, profile.name);
          await disconnectGoogle(id as GoogleService);
          await loadGoogle(phoneE164, profile.name);
          showToast("Услугата е прекъсната.", "Service disconnected.");
        } catch {
          showToast("Неуспешно прекъсване. Опитай пак.", "Couldn’t disconnect. Please try again.");
        }
      } else {
        // Real Google OAuth — full-page redirect that shows the account chooser.
        setModal(null);
        try {
          await ensureSession(phoneE164, profile.name);
        } catch {
          /* proceed; the callback will report if truly unauthenticated */
        }
        window.location.href = googleConnectUrl(id as GoogleService);
      }
    } else {
      setSimConnected((prev) => {
        const nextSet = new Set(prev);
        if (nextSet.has(id)) nextSet.delete(id);
        else nextSet.add(id);
        return nextSet;
      });
      setModal(null);
    }
  };

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
            connected={connectedSet}
            phoneE164={phoneE164}
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
            connected={connectedSet}
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
          connected={connectedSet.has(modal.service)}
          onClose={() => setModal(null)}
          onToggle={() => void onServiceAction(modal.service)}
        />
      )}

      <Toast message={toast} />
    </>
  );
}
