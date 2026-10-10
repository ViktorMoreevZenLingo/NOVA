"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { synthesizeSpeech, transcribeAudio } from "@/lib/voice-api";

const TTS_KEY = "alo.tts";

function toPlainText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .trim();
}

// Browser mic recording + OpenAI STT/TTS playback for the chat.
export function useVoiceChat(lang: Lang) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [ttsEnabled, setTtsEnabledState] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    setSupported(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined",
    );
    try {
      setTtsEnabledState(localStorage.getItem(TTS_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const getAudio = () => {
    if (!audioRef.current && typeof Audio !== "undefined") {
      audioRef.current = new Audio();
    }
    return audioRef.current;
  };

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setSpeaking(false);
  }, []);

  const setTtsEnabled = useCallback(
    (value: boolean) => {
      setTtsEnabledState(value);
      try {
        localStorage.setItem(TTS_KEY, value ? "1" : "0");
      } catch {
        /* ignore */
      }
      if (value) {
        // Unlock playback inside this click so later auto-speak isn't blocked.
        const a = getAudio();
        a?.play().then(() => a.pause()).catch(() => {});
      } else {
        stopAudio();
      }
    },
    [stopAudio],
  );

  // Fetch TTS and play it. Throws on failure so direct-click callers can report.
  const play = useCallback(
    async (text: string) => {
      const plain = toPlainText(text);
      if (!plain) return;
      const blob = await synthesizeSpeech(plain.slice(0, 4000), lang);
      const a = getAudio();
      if (!a) return;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      a.src = url;
      a.onended = () => setSpeaking(false);
      setSpeaking(true);
      try {
        await a.play();
      } catch (err) {
        setSpeaking(false);
        throw err;
      }
    },
    [lang],
  );

  // Auto-speak after a reply when enabled; best-effort (never surfaces errors).
  const speak = useCallback(
    async (text: string) => {
      if (!ttsEnabled) return;
      try {
        await play(text);
      } catch {
        /* best effort; the per-message speaker button is the reliable path */
      }
    },
    [ttsEnabled, play],
  );

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
  }, []);

  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      setRecording(false);
      return null;
    }
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () =>
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
      recorder.stop();
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRecording(false);
    return blob.size ? blob : null;
  }, []);

  const transcribe = useCallback(
    async (audio: Blob): Promise<string> => {
      setTranscribing(true);
      try {
        return await transcribeAudio(audio, lang);
      } finally {
        setTranscribing(false);
      }
    },
    [lang],
  );

  useEffect(
    () => () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  return {
    supported,
    recording,
    transcribing,
    ttsEnabled,
    setTtsEnabled,
    speaking,
    startRecording,
    stopRecording,
    transcribe,
    speak,
    play,
    stopAudio,
  };
}
