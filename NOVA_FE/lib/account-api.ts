import { getSupabase, invoke } from "./supabase";
import { blankProfile, type Profile } from "./profile-store";
import type { HistoryRecord } from "./history-data";
import type { ServiceId } from "./services";

export async function requestOtp(phone: string, signup: boolean) {
  const { error } = await getSupabase().auth.signInWithOtp({
    phone: `+359${phone}`,
    options: { shouldCreateUser: signup },
  });
  if (error) throw error;
}
export async function verifyOtp(phone: string, token: string) {
  const { error } = await getSupabase().auth.verifyOtp({
    phone: `+359${phone}`,
    token,
    type: "sms",
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
  if (!user?.phone) throw new Error("A verified phone number is required.");
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
    phone: user.phone.replace(/^\+?359/, ""),
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
