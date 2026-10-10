import { getSupabase } from "./supabase";

// Calls the `voice` Edge Function (OpenAI STT/TTS). Binary bodies/responses, so
// we use fetch directly (with the user's session token) rather than invoke().
async function voiceFetch(init: RequestInit, query = ""): Promise<Response> {
  const sb = getSupabase();
  const {
    data: { session },
  } = await sb.auth.getSession();
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) throw new Error("Supabase is not configured.");
  const headers = new Headers(init.headers);
  headers.set("apikey", key);
  if (session) headers.set("Authorization", `Bearer ${session.access_token}`);
  return fetch(`${base}/functions/v1/voice${query}`, { ...init, headers });
}

async function errText(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return (data?.error as string) || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Transcribe recorded audio to text (OpenAI Whisper). */
export async function transcribeAudio(audio: Blob, lang: "bg" | "en"): Promise<string> {
  const res = await voiceFetch(
    {
      method: "POST",
      headers: { "Content-Type": audio.type || "audio/webm" },
      body: audio,
    },
    `?lang=${lang}`,
  );
  if (!res.ok) throw new Error(await errText(res));
  const { text } = (await res.json()) as { text: string };
  return text || "";
}

/** Synthesize speech from text (OpenAI TTS); returns an mp3 blob. */
export async function synthesizeSpeech(text: string, lang: "bg" | "en"): Promise<Blob> {
  const res = await voiceFetch({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang }),
  });
  if (!res.ok) throw new Error(await errText(res));
  return await res.blob();
}
