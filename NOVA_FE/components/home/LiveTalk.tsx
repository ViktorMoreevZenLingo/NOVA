"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Icon } from "@/components/ui/Icon";
import { confirmAction, sendChat, type PendingAction } from "@/lib/agent-api";
import { synthesizeSpeech, transcribeAudio } from "@/lib/voice-api";

type Status = "connecting" | "listening" | "thinking" | "speaking" | "confirm" | "error";

// Voice-activity thresholds (RMS on a -1..1 waveform).
const SPEAK_LEVEL = 0.025;
const SILENCE_MS = 1300;
const MAX_UTTERANCE_MS = 15000;

const stripMarkdown = (t: string) =>
  t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1").replace(/https?:\/\/\S+/g, "").trim();

export function LiveTalk({ onClose }: { onClose: () => void }) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const [status, setStatus] = useState<Status>("connecting");
  const [muted, setMuted] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const spokeRef = useRef(false);
  const silenceRef = useRef<number | null>(null);
  const startRef = useRef(0);
  const mutedRef = useRef(false);
  const aliveRef = useRef(true);

  const stopPlayback = useCallback(() => {
    try {
      sourceRef.current?.stop();
    } catch {
      /* already stopped */
    }
    sourceRef.current = null;
  }, []);

  // Play TTS through the AudioContext so it isn't subject to <audio> autoplay
  // blocking (the context is resumed on a user gesture when live mode opens).
  const speak = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        const plain = stripMarkdown(text);
        const ctx = ctxRef.current;
        if (!plain || !ctx) return resolve();
        synthesizeSpeech(plain.slice(0, 4000), lang)
          .then(async (blob) => {
            if (!aliveRef.current) return resolve();
            try {
              const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
              if (!aliveRef.current) return resolve();
              try {
                sourceRef.current?.stop();
              } catch {
                /* ignore */
              }
              if (ctx.state === "suspended") await ctx.resume().catch(() => {});
              const node = ctx.createBufferSource();
              node.buffer = buffer;
              node.connect(ctx.destination);
              let done = false;
              const finish = () => {
                if (done) return;
                done = true;
                resolve();
              };
              node.onended = finish;
              sourceRef.current = node;
              node.start();
              // Safety net: always hand control back even if onended never fires.
              setTimeout(finish, buffer.duration * 1000 + 800);
            } catch {
              resolve();
            }
          })
          .catch(() => resolve());
      }),
    [lang],
  );

  // --- listening + voice-activity detection ---------------------------------

  const monitor = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    setLevel(Math.min(1, rms * 6));
    const now = performance.now();
    if (rms > SPEAK_LEVEL) {
      spokeRef.current = true;
      silenceRef.current = null;
    } else if (spokeRef.current) {
      if (silenceRef.current == null) silenceRef.current = now;
      else if (now - silenceRef.current > SILENCE_MS) {
        stopRecording();
        return;
      }
    }
    if (now - startRef.current > MAX_UTTERANCE_MS && spokeRef.current) {
      stopRecording();
      return;
    }
    rafRef.current = requestAnimationFrame(monitor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startListening = useCallback(() => {
    if (!aliveRef.current || mutedRef.current) return;
    const stream = streamRef.current;
    if (!stream) return;
    stopPlayback();
    chunksRef.current = [];
    spokeRef.current = false;
    silenceRef.current = null;
    startRef.current = performance.now();
    const recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      if (!spokeRef.current || blob.size < 1200) {
        // Nothing meaningful heard — keep listening.
        if (aliveRef.current && !mutedRef.current) startListening();
        return;
      }
      void processTurn(blob);
    };
    recorderRef.current = recorder;
    recorder.start();
    setStatus("listening");
    rafRef.current = requestAnimationFrame(monitor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monitor, stopPlayback]);

  const stopRecording = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const processTurn = useCallback(
    async (blob: Blob) => {
      setStatus("thinking");
      setLevel(0);
      try {
        const text = (await transcribeAudio(blob, lang)).trim();
        if (!aliveRef.current) return;
        if (!text) {
          startListening();
          return;
        }
        const res = await sendChat(text);
        if (!aliveRef.current) return;
        if (res.pending) {
          setPending(res.pending);
          setStatus("confirm");
          await speak(res.pending.summary);
          return;
        }
        setStatus("speaking");
        if (res.reply) await speak(res.reply);
        if (!aliveRef.current) return;
        startListening();
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err instanceof Error ? err.message : l("Нещо се обърка.", "Something went wrong."));
        setStatus("error");
      }
    },
    [lang, speak, startListening, l],
  );

  const resolvePending = useCallback(
    async (approved: boolean) => {
      const action = pending;
      if (!action) return;
      setPending(null);
      setStatus("thinking");
      try {
        const res = await confirmAction(approved, action.id);
        if (!aliveRef.current) return;
        setStatus("speaking");
        if (res.reply) await speak(res.reply);
        if (!aliveRef.current) return;
        startListening();
      } catch (err) {
        if (!aliveRef.current) return;
        setError(err instanceof Error ? err.message : l("Нещо се обърка.", "Something went wrong."));
        setStatus("error");
      }
    },
    [pending, speak, startListening, l],
  );

  // --- setup / teardown -----------------------------------------------------

  useEffect(() => {
    aliveRef.current = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (!aliveRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        ctxRef.current = ctx;
        await ctx.resume().catch(() => {});
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        analyserRef.current = analyser;
        startListening();
      } catch {
        setError(l("Нужен е достъп до микрофона.", "Microphone access is needed."));
        setStatus("error");
      }
    })();
    return () => {
      aliveRef.current = false;
      cancelAnimationFrame(rafRef.current);
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      stopPlayback();
      ctxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    if (next) {
      cancelAnimationFrame(rafRef.current);
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
      setLevel(0);
    } else if (status !== "speaking" && status !== "thinking") {
      startListening();
    }
  };

  // Tap the orb: interrupt Alo, or end your turn now.
  const onOrbTap = () => {
    if (status === "speaking") {
      stopPlayback();
      startListening();
    } else if (status === "listening" && spokeRef.current) {
      stopRecording();
    }
  };

  const statusText =
    error
      ? error
      : status === "connecting"
        ? l("Свързване…", "Connecting…")
        : status === "listening"
          ? muted ? l("На пауза", "Paused") : l("Слушам…", "Listening…")
          : status === "thinking"
            ? l("Мисля…", "Thinking…")
            : status === "speaking"
              ? l("Ало говори…", "Alo is speaking…")
              : status === "confirm"
                ? l("Потвърди действието", "Confirm the action")
                : "";

  return (
    <div className="live-talk" role="group" aria-label={l("Говори с Ало", "Talk to Alo")}>
      <div
        className={`live-orb ${status}`}
        style={{ transform: `scale(${1 + (status === "listening" ? level * 0.35 : 0)})` }}
        onClick={onOrbTap}
        role="button"
        aria-label={l("Говори", "Speak")}
      />

      <p className="live-status">{statusText}</p>

      {status === "confirm" && pending && (
        <div className="live-confirm">
          <p>{pending.summary}</p>
          <div className="live-confirm-actions">
            <button type="button" className="secondary" onClick={() => void resolvePending(false)}>
              {l("Откажи", "Reject")}
            </button>
            <button type="button" className="primary" onClick={() => void resolvePending(true)}>
              {l("Потвърди", "Approve")}
            </button>
          </div>
        </div>
      )}

      <div className="live-controls">
        <button
          type="button"
          className={`live-btn${muted ? " off" : ""}`}
          aria-pressed={muted}
          aria-label={muted ? l("Пусни микрофона", "Unmute") : l("Заглуши", "Mute")}
          onClick={toggleMute}
        >
          <Icon name="mic" />
        </button>
        <button
          type="button"
          className="live-btn close"
          aria-label={l("Затвори", "Close")}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}
