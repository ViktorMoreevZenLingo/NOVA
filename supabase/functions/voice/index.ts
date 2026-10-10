import {
  authenticate,
  cors,
  env,
  failure,
  HttpError,
  json,
} from "../_shared/http.ts";

// Speech-to-text and text-to-speech via OpenAI. The API key stays server-side.
// - JSON body { text, lang }           → audio/mpeg (TTS)
// - raw audio body (?lang=bg|en)       → { text }   (STT)
const STT_MODEL = Deno.env.get("OPENAI_STT_MODEL") || "whisper-1";
const TTS_MODEL = Deno.env.get("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts";
const TTS_VOICE = Deno.env.get("OPENAI_TTS_VOICE") || "coral";
const TTS_INSTRUCTIONS = Deno.env.get("OPENAI_TTS_INSTRUCTIONS") ||
  "Speak in a warm, friendly and natural conversational tone, like a helpful " +
    "personal phone assistant. Clear pronunciation, calm and pleasant pace. " +
    "Match the language of the text (Bulgarian or English).";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
    await authenticate(req); // require a signed-in user; never expose the key
    const contentType = req.headers.get("content-type") || "";

    // --- Text-to-speech ---
    if (contentType.includes("application/json")) {
      const body = await req.json();
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) throw new HttpError(400, "No text to speak.");
      if (text.length > 4000) throw new HttpError(400, "Text is too long to speak.");
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env("OPENAI_API_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: TTS_MODEL,
          voice: TTS_VOICE,
          input: text,
          response_format: "mp3",
          // Steerable style; supported by gpt-4o(-mini)-tts, ignored otherwise.
          ...(TTS_MODEL.startsWith("gpt-4o") && TTS_INSTRUCTIONS
            ? { instructions: TTS_INSTRUCTIONS }
            : {}),
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new HttpError(502, "Speech synthesis failed.");
      return new Response(await res.arrayBuffer(), {
        status: 200,
        headers: { ...cors(), "Content-Type": "audio/mpeg" },
      });
    }

    // --- Speech-to-text ---
    const audio = await req.arrayBuffer();
    if (audio.byteLength === 0) throw new HttpError(400, "No audio received.");
    if (audio.byteLength > 25 * 1024 * 1024) {
      throw new HttpError(413, "Audio is too large.");
    }
    const lang = new URL(req.url).searchParams.get("lang") || "";
    const ext = contentType.includes("mp4") || contentType.includes("m4a")
      ? "mp4"
      : contentType.includes("mpeg") || contentType.includes("mp3")
      ? "mp3"
      : contentType.includes("wav")
      ? "wav"
      : contentType.includes("ogg")
      ? "ogg"
      : "webm";
    const form = new FormData();
    form.append(
      "file",
      new Blob([audio], { type: contentType || "audio/webm" }),
      `audio.${ext}`,
    );
    form.append("model", STT_MODEL);
    if (lang === "bg" || lang === "en") form.append("language", lang);
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new HttpError(502, "Transcription failed.");
    const data = await res.json();
    return json({ text: typeof data.text === "string" ? data.text : "" });
  } catch (err) {
    return failure(err);
  }
});
