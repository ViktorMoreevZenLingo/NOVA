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
import { blankProfile, type Profile } from "@/lib/profile-store";
import type { ServiceId } from "@/lib/services";
import type { HistoryRecord } from "@/lib/history-data";
import { MOCK_HISTORY } from "@/lib/history-mock-data";
import {
  loadAccount,
  createAccessLink,
  startAccount,
  updateProfile,
  signOut,
  deleteAccount,
  changeConnection,
} from "@/lib/account-api";
import { getSupabase } from "@/lib/supabase";

type View = "login" | "otp" | "profile-setup" | DashView;
type Modal = "options" | "edit" | "delete" | { service: ServiceId } | null;

export function AloApp() {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [view, setView] = useState<View>("login");
  const [mode, setMode] = useState<AuthMode>("login");
  const [phone, setPhone] = useState("");
  const [profile, setProfile] = useState<Profile>(blankProfile());
  const [connected, setConnected] = useState<Set<ServiceId>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [toast, setToast] = useState<string | null>(null);
  const accountGeneration = useRef(0);
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
    document.title =
      lang === "en"
        ? "Alo — your personal assistant"
        : "Ало — личният ти асистент";
  }, [lang]);

  const navigate = useCallback((next: View) => {
    if (next === "history") setSelected(null);
    setView(next);
    window.scrollTo(0, 0);
  }, []);

  const clearAccount = useCallback(() => {
    accountGeneration.current++;
    setModal(null);
    setMode("login");
    setPhone("");
    setProfile(blankProfile());
    setConnected(new Set());
    setRecords([]);
    setSelected(null);
    setView("login");
  }, []);

  const refreshAccount = useCallback(async () => {
    const generation = accountGeneration.current;
    const account = await loadAccount();
    if (generation !== accountGeneration.current) return;
    if (!account) {
      clearAccount();
      return;
    }
    setPhone(account.phone);
    setProfile(account.profile);
    setConnected(account.connected);
    setRecords(account.records);
    setView((current) =>
      ["login", "otp"].includes(current)
        ? "dashboard"
        : current,
    );
  }, [clearAccount]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("connection_error"))
      setToast("Connection was not completed. Please try again.");
    if (params.has("connection_error") || params.has("connected"))
      window.history.replaceState(null, "", window.location.pathname);
    let active = true;
    let unsubscribe = () => {};
    const init = async () => {
      try {
        const sb = getSupabase();
        const account = await loadAccount();
        if (!active) return;
        if (account) {
          setPhone(account.phone);
          setProfile(account.profile);
          setConnected(account.connected);
          setRecords(account.records);
          const service = params.get("connected") as ServiceId | null;
          if (service && account.connected.has(service))
            setToast("Service connected.");
          setView(
            service || params.has("connection_error")
              ? "integrations"
              : "dashboard",
          );
        }
        const { data } = sb.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_OUT") clearAccount();
        });
        unsubscribe = () => data.subscription.unsubscribe();
      } catch (err) {
        if (active)
          setLoadError(
            err instanceof Error ? err.message : "Could not load account.",
          );
      } finally {
        if (active) setLoading(false);
      }
    };
    void init();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [clearAccount]);

  useEffect(() => {
    const refresh = () => {
      if (phone && !["login", "otp"].includes(view))
        void refreshAccount().catch((err) => setToast(err.message));
    };
    window.addEventListener("focus", refresh);
    const interval = setInterval(refresh, 30000);
    return () => {
      window.removeEventListener("focus", refresh);
      clearInterval(interval);
    };
  }, [phone, view, refreshAccount]);

  const logout = async () => {
    try {
      await signOut();
      clearAccount();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Could not sign out.");
    }
  };
  const saveProfileAndClose = async (next: Profile, closeTo: () => void) => {
    await updateProfile(next);
    setProfile(next);
    closeTo();
  };
  const toggleService = async (id: ServiceId) => {
    await changeConnection(id, connected.has(id));
    await refreshAccount();
    setModal(null);
  };

  if (loading)
    return (
      <main className="app-loading" role="status" aria-label={l("Зареждане…", "Loading…")}>
        <span className="app-loading-spinner" aria-hidden="true" />
      </main>
    );
  if (loadError)
    return (
      <main className="auth-content">
        <h1>Alo</h1>
        <p role="alert">{loadError}</p>
        <button className="primary" onClick={() => window.location.reload()}>
          {l("Опитай отново", "Retry")}
        </button>
      </main>
    );

  // ---- Auth / profile-setup screens -------------------------------------
  if (view === "login" || view === "otp") {
    return (
      <>
        <Auth
          mode={mode}
          setMode={setMode}
          phone={phone}
          setPhone={setPhone}
          onPhoneSubmit={async (number) => {
            const destination = mode === "signup" ? "profile-setup" : "dashboard";
            await startAccount(number, mode);
            await refreshAccount();
            navigate(destination);
          }}
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
              <p className="profile-intro">
                {l(
                  "Можеш да промениш всичко по-късно.",
                  "You can change these details anytime.",
                )}
              </p>
              <ProfileForm
                profile={profile}
                submitLabel={l("Продължи", "Continue")}
                phone={formatPhone(phone)}
                onSave={(next) =>
                  saveProfileAndClose(next, () => navigate("dashboard"))
                }
              />
            </div>
          </main>
          <aside className="auth-photo">
            <img
              src="/assets/phone-conversation.jpg"
              alt={l(
                "Жена, която разговаря по телефона, седнала на стълби",
                "A woman sitting on steps talking on the phone",
              )}
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
        <Toast message={toast} />
      </>
    );
  }

  // ---- Dashboard shell ---------------------------------------------------
  const firstName = profile.name.trim().split(/\s+/)[0] || "";
  const historyRecords = [...records, ...MOCK_HISTORY.filter((mock) => !records.some((record) => record.id === mock.id))];
  const breadcrumbTitle =
    view === "history" && selected
      ? historyRecords.find((r) => r.id === selected)?.title[lang]
      : null;

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
            records={records}
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
        {view === "history" && (
          <History
            onTaskUpdated={() => { void refreshAccount().catch(() => setToast(l("Неуспешно обновяване.", "Could not refresh History."))); }}
            records={historyRecords}
            selected={selected}
            onSelect={(id) => setSelected(id)}
          />
        )}
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
          onAccessLink={async () => {
            try {
              const url = await createAccessLink();
              await navigator.clipboard.writeText(url);
              setToast(l("Линкът е копиран. Валиден е 15 минути и се използва веднъж. Пази го само за себе си.", "Link copied. Valid for 15 minutes and one use. Keep it private."));
            } catch (err) { setToast(err instanceof Error ? err.message : "Could not create link."); }
          }}
          onLogout={logout}
          onDelete={() => setModal("delete")}
        />
      )}

      {modal === "edit" && (
        <EditProfileDialog
          profile={profile}
          phone={phone}
          onClose={() => setModal(null)}
          onSave={async (next) => {
            await saveProfileAndClose(next, () => setModal(null));
            showToast("Профилът е запазен.", "Profile saved.");
          }}
        />
      )}

      {modal === "delete" && (
        <DeleteAccountDialog
          phone={phone}
          onClose={() => setModal("options")}
          onConfirm={async () => {
            await deleteAccount(phone);
            clearAccount();
            showToast("Профилът е изтрит.", "Account deleted.");
          }}
        />
      )}

      {modal && typeof modal === "object" && "service" in modal && (
        <ServiceDialog
          id={modal.service}
          connected={connected.has(modal.service)}
          onClose={() => setModal(null)}
          onToggle={() => toggleService(modal.service)}
        />
      )}

      <Toast message={toast} />
    </>
  );
}
