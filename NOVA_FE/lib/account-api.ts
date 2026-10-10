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

/** Archived Alo conversations for the History page, newest first. */
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

// Phone is profile context only during the prototype. Never use it to find or
// authorize another account. Supabase's anonymous session supplies the owner ID.
export async function startAccount(phone: string) {
  if (!/^[89]\d{8}$/.test(phone)) throw new Error("Enter a valid Bulgarian mobile number.");
  const sb = getSupabase();
  const { data: { session }, error: sessionError } = await sb.auth.getSession();
  if (sessionError) throw sessionError;
  if (session) return;
  const { error } = await sb.auth.signInAnonymously({
    options: { data: { contact_phone: `+359${phone}` } },
  });
  if (error) throw error;
}
export async function loadAccount() {
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
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}
export async function deleteAccount(phone: string) {
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
