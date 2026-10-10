import { getSupabase, invoke } from "./supabase";
import { blankProfile, type Profile } from "./profile-store";
import type { HistoryRecord } from "./history-data";
import type { ServiceId } from "./services";

export interface ChatSession {
  id: string;
  title: string | null;
  ended_at: string;
  messages: { role: "user" | "alo"; text: string }[];
}

/** Archived NOVA AI conversations for the History page, newest first. */
export async function loadChatSessions(): Promise<ChatSession[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("chat_sessions")
    .select("id,title,ended_at,messages")
    .order("ended_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []) as ChatSession[];
}

type AccountSession = { session: { access_token: string; refresh_token: string }; phone: string; device_key: string };
let restored: Promise<void> | undefined;
const deviceKey = (phone: string) => `alo.device.${phone}`;
async function acceptSession(result: AccountSession) {
  const { error } = await getSupabase().auth.setSession(result.session);
  if (error) throw error;
  localStorage.setItem(deviceKey(result.phone), result.device_key);
}
async function restoreAccount() {
  const sb = getSupabase();
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const key = fragment.get("alo_access");
  if (key) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    await acceptSession(await invoke<AccountSession>("account-session", { action: "redeem", key }));
    return;
  }
  const { data: { session } } = await sb.auth.getSession();
  if (session) await acceptSession(await invoke<AccountSession>("account-session", { action: "resume" }));
}
// Restore only once per page load, not on every dashboard refresh.
function ensureAccount() {
  return restored ??= restoreAccount().catch(error => { restored = undefined; throw error; });
}
export async function startAccount(phone: string, mode: "login" | "signup" = "login") {
  if (!/^[89]\d{8}$/.test(phone)) throw new Error("Въведи валиден български мобилен номер.");
  const full = `+359${phone}`, sb = getSupabase();
  const key = localStorage.getItem(deviceKey(full));
  if (key) {
    await acceptSession(await invoke<AccountSession>("account-session", { action: "redeem", key, phone: full }));
    restored = Promise.resolve();
    return;
  }
  if (mode !== "signup") throw new Error("Отвори личния си линк за вход на този браузър. Нов потребител? Избери Регистрация.");
  const { error } = await sb.auth.signInAnonymously({ options: { data: { contact_phone: full } } });
  if (error) throw new Error("Регистрацията не е завършена. Ако вече имаш акаунт с този номер, използвай личния си линк за вход.");
  await acceptSession(await invoke<AccountSession>("account-session", { action: "resume" }));
  restored = Promise.resolve();
}
export async function createAccessLink() {
  return (await invoke<{url: string}>("account-session", {action: "link"})).url;
}
export async function loadAccount() {
  await ensureAccount();
  const sb = getSupabase();
  const {
    data: { session },
    error: sessionError,
  } = await sb.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) return null;
  const {
    data: { user },
    error,
  } = await sb.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error("Please start again.");
  const contactPhone = user.phone || user.user_metadata?.contact_phone;
  if (typeof contactPhone !== "string") throw new Error("Your profile has no phone number.");
  const [p, c, h] = await Promise.all([
    sb
      .from("profiles")
      .select("name,notes,photo")
      .eq("id", user.id)
      .maybeSingle(),
    sb.from("connections").select("service").eq("user_id", user.id),
    sb
      .from("activity")
      .select(
        "id,type,date,status,duration,title,detail,message,transcript,call,task",
      )
      .eq("user_id", user.id)
      .order("date", { ascending: false }),
  ]);
  for (const result of [p, c, h]) if (result.error) throw result.error;
  return {
    phone: contactPhone.replace(/^\+?359/, ""),
    profile: (p.data || blankProfile()) as Profile,
    connected: new Set<ServiceId>(
      (c.data || []).map((r) => r.service as ServiceId),
    ),
    records: (h.data || []) as HistoryRecord[],
  };
}
export async function updateProfile(profile: Profile) {
  const sb = getSupabase();
  const {
    data: { user },
    error,
  } = await sb.auth.getUser();
  if (error || !user) throw error || new Error("Please sign in again.");
  const { error: saveError } = await sb
    .from("profiles")
    .upsert({ id: user.id, ...profile });
  if (saveError) throw saveError;
}
export async function signOut() {
  restored = Promise.resolve();
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}
export async function deleteAccount(phone: string) {
  localStorage.removeItem(deviceKey(`+359${phone}`));
  await invoke("account-delete", { phone: `+359${phone}` });
  await getSupabase().auth.signOut({ scope: "local" });
}
export async function changeConnection(service: ServiceId, connected: boolean) {
  const result = await invoke<{ url?: string }>("integrations", {
    action: connected ? "disconnect" : "connect",
    service,
  });
  if (result.url) window.location.assign(result.url);
}
