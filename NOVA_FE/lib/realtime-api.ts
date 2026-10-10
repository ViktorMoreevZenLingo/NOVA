import { getSupabase } from "./supabase";

// Gets a short-lived OpenAI Realtime session token from our edge function.
export async function getRealtimeSession(
  lang: "bg" | "en",
): Promise<{ token: string; model: string }> {
  const sb = getSupabase();
  const {
    data: { session },
  } = await sb.auth.getSession();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) throw new Error("Supabase is not configured.");
  const res = await fetch(`${base}/functions/v1/realtime`, {
    method: "POST",
    headers: {
      apikey: key,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ lang }),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      message = (await res.json()).error || message;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json();
}

// Executes a read tool server-side for a live function call and returns a
// string result to feed back to the Realtime model.
export async function execRealtimeTool(name: string, args: unknown): Promise<string> {
  const sb = getSupabase();
  const {
    data: { session },
  } = await sb.auth.getSession();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) throw new Error("Supabase is not configured.");
  const res = await fetch(`${base}/functions/v1/realtime-tool`, {
    method: "POST",
    headers: {
      apikey: key,
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, args }),
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      message = (await res.json()).error || message;
    } catch {
      /* ignore */
    }
    return `Error: ${message}`;
  }
  return (await res.json()).result ?? "";
}
