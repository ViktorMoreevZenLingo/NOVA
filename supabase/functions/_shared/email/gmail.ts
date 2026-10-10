// Per-user Gmail access through the Alo app's Google OAuth connection
// (public.connections + provider_tokens, see ../providers.ts and ../tools.ts).
import { admin } from "../http.ts";
import { accessToken } from "../providers.ts";

export async function hasGmail(userId: string): Promise<boolean> {
  const { data, error } = await admin()
    .from("connections")
    .select("service")
    .eq("user_id", userId)
    .eq("service", "gmail")
    .maybeSingle();
  if (error) throw new Error(`DB connections lookup failed: ${error.message}`);
  return data !== null;
}

/** The address of the user's own connected Gmail account. */
export async function ownGmailAddress(userId: string): Promise<string> {
  const token = await accessToken(userId, "gmail");
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Gmail profile lookup failed: HTTP ${res.status}`);
  const { emailAddress } = await res.json();
  if (typeof emailAddress !== "string" || !emailAddress.includes("@")) throw new Error("Gmail profile has no address");
  return emailAddress;
}
