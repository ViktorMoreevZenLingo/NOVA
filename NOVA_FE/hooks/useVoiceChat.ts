"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Lang } from "@/lib/i18n";
import { synthesizeSpeech, transcribeAudio } from "@/lib/voice-api";

const TTS_KEY = "alo.tts";

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

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
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
      if (!value) stopAudio();
    },
    [stopAudio],
  );

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

  // Stop recording and return the recorded audio (or null if empty).
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

  const speak = useCallback(
    async (text: string) => {
      if (!ttsEnabled) return;
      // Don't read Markdown link syntax / raw URLs aloud.
      const plain = text
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
        .replace(/https?:\/\/\S+/g, "")
        .trim();
      if (!plain) return;
      try {
        const blob = await synthesizeSpeech(plain.slice(0, 4000), lang);
        const url = URL.createObjectURL(blob);
        stopAudio();
        const audio = new Audio(url);
        audioRef.current = audio;
        const cleanup = () => {
          setSpeaking(false);
          URL.revokeObjectURL(url);
        };
        audio.onended = cleanup;
        audio.onerror = cleanup;
        setSpeaking(true);
        await audio.play();
      } catch {
        setSpeaking(false);
      }
    },
    [ttsEnabled, lang, stopAudio],
  );

  useEffect(
    () => () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      audioRef.current?.pause();
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
    stopAudio,
  };
}
