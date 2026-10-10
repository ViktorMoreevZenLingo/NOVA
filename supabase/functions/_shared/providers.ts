import { admin, checked, env, HttpError } from "./http.ts";
export const scopes: Record<string, string> = {
  gmail: "https://www.googleapis.com/auth/gmail.modify",
  calendar: "https://www.googleapis.com/auth/calendar",
  contacts: "https://www.googleapis.com/auth/contacts.readonly",
  outlook:
    "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Calendars.Read https://graph.microsoft.com/Contacts.Read",
};
export function provider(service: string) {
  const microsoft = service === "outlook";
  return {
    authorize: microsoft
      ? "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
      : "https://accounts.google.com/o/oauth2/v2/auth",
    token: microsoft
      ? "https://login.microsoftonline.com/common/oauth2/v2.0/token"
      : "https://oauth2.googleapis.com/token",
    client: env(microsoft ? "MICROSOFT_CLIENT_ID" : "GOOGLE_CLIENT_ID"),
    secret: env(microsoft ? "MICROSOFT_CLIENT_SECRET" : "GOOGLE_CLIENT_SECRET"),
    scope: scopes[service] + (microsoft ? " offline_access" : ""),
  };
}
export const callbackUrl = () =>
  `${env("SUPABASE_URL")}/functions/v1/integrations`;
export function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(
    /\//g,
    "_",
  ).replace(/=+$/, "");
}
export async function tokenRequest(
  service: string,
  values: Record<string, string>,
) {
  const p = provider(service);
  const response = await fetch(p.token, {
    method: "POST",
    body: new URLSearchParams({
      client_id: p.client,
      client_secret: p.secret,
      ...values,
    }),
  });
  if (!response.ok) {
    throw new HttpError(
      400,
      "Authorization expired or failed. Please connect the service again.",
    );
  }
  return response.json();
}
export async function accessToken(userId: string, service: string) {
  const db = admin();
  const connection = checked(
    await db.from("connections").select("service").eq("user_id", userId).eq(
      "service",
      service,
    ).maybeSingle(),
  ).data;
  if (!connection) {
    throw new HttpError(400, "Please connect this service first.");
  }
  const row = checked(
    await db.from("provider_tokens").select("*").eq("user_id", userId).eq(
      "service",
      service,
    ).single(),
  ).data;
  if (Date.parse(row.expires_at) > Date.now() + 60000) {
    return row.access_token as string;
  }
  const token = await tokenRequest(service, {
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
  });
  // UPDATE, never upsert: a concurrent disconnect must not resurrect credentials.
  checked(
    await db.from("provider_tokens").update({
      access_token: token.access_token,
      refresh_token: token.refresh_token || row.refresh_token,
      expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    }).eq("user_id", userId).eq("service", service),
  );
  return token.access_token as string;
}
