"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Icon } from "@/components/ui/Icon";
import { execRealtimeTool, getRealtimeSession } from "@/lib/realtime-api";
import { appendChat } from "@/lib/agent-api";

type Status = "connecting" | "listening" | "speaking" | "error";

interface RtItem {
  type: string;
  role?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  content?: { type?: string; text?: string; transcript?: string }[];
}

const debug = (...a: unknown[]) => console.debug("[live]", ...a);

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const INACTIVITY_MS = 90_000; // auto-end an idle session to avoid wasted cost
const ACTIVE_LEVEL = 0.02;

// OpenAI Realtime (gpt-realtime-mini) over WebRTC: the browser streams the mic
// and plays the model's speech directly; server-side turn detection handles
// listen/respond. We drive the orb/status from audio levels (robust to event
// name changes) and auto-close on inactivity.
export function LiveTalk({ onClose }: { onClose: () => void }) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const [status, setStatus] = useState<Status>("connecting");
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteAnalyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef(0);
  const idleRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const lastActiveRef = useRef(0);
  const statusRef = useRef<Status>("connecting");
  const levelRef = useRef(0);
  const appendQueueRef = useRef<Promise<void>>(Promise.resolve());
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Save each turn to the shared conversation as it happens, serialized so the
  // appends don't race the agent lock.
  const saveTurn = (role: "user" | "alo", text: string) => {
    const clean = text.trim();
    if (!clean) return;
    debug("save turn", role, clean);
    appendQueueRef.current = appendQueueRef.current
      .then(() => appendChat([{ role, text: clean }]))
      .then(() => debug("append ok", role))
      .catch((err) => debug("append FAILED", err));
  };

  // Wait for pending saves, then close so the chat reload shows everything.
  const persistAndClose = async () => {
    try {
      await appendQueueRef.current;
    } catch {
      /* already logged */
    }
    onCloseRef.current();
  };
  const closeRef = useRef(persistAndClose);
  closeRef.current = persistAndClose;

  const setStatusOnce = (s: Status) => {
    if (statusRef.current === s) return;
    statusRef.current = s;
    setStatus(s);
  };

  const rms = (analyser: AnalyserNode | null) => {
    if (!analyser) return 0;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  };

  const monitor = () => {
    const mic = rms(micAnalyserRef.current);
    const remote = rms(remoteAnalyserRef.current);
    const peak = Math.max(mic, remote);
    const next = Math.min(1, peak * 6);
    if (Math.abs(next - levelRef.current) > 0.04) {
      levelRef.current = next;
      setLevel(next);
    }
    if (statusRef.current !== "connecting" && statusRef.current !== "error") {
      setStatusOnce(remote > ACTIVE_LEVEL ? "speaking" : "listening");
    }
    if (peak > ACTIVE_LEVEL) lastActiveRef.current = performance.now();
    rafRef.current = requestAnimationFrame(monitor);
  };

  // Run the model's tool calls server-side and feed the results back.
  const runToolCalls = async (calls: RtItem[]) => {
    for (const call of calls) {
      let args: unknown = {};
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        args = {};
      }
      const result = await execRealtimeTool(call.name || "", args);
      dcRef.current?.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: call.call_id || "", output: result },
        }),
      );
    }
    lastActiveRef.current = performance.now();
    dcRef.current?.send(JSON.stringify({ type: "response.create" }));
  };

  const handleEvent = (raw: string) => {
    let ev: { type?: string; transcript?: string; response?: { output?: RtItem[] } };
    try {
      ev = JSON.parse(raw);
    } catch {
      return;
    }
    const t = ev.type || "";
    debug("event", t);
    // User's turn — from the input transcription.
    if (t.includes("input_audio_transcription.completed") && ev.transcript?.trim()) {
      saveTurn("user", ev.transcript);
      return;
    }
    if (t !== "response.done") return;
    const output = ev.response?.output || [];
    const calls = output.filter((i) => i.type === "function_call");
    if (calls.length) {
      void runToolCalls(calls);
      return;
    }
    // Alo's turn — the transcript of the assistant message.
    for (const item of output) {
      if (item.type === "message" && item.role === "assistant") {
        const text = (item.content || [])
          .map((p) => p.transcript || p.text || "")
          .join(" ")
          .trim();
        if (text) saveTurn("alo", text);
      }
    }
  };

  useEffect(() => {
    // Per-run flag: a StrictMode re-run (dev) must not leave the first WebRTC
    // session alive, which would double the audio.
    let cancelled = false;
    (async () => {
      try {
        const { token, model } = await getRealtimeSession(lang);
        if (cancelled) return;

        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        const audioEl = new Audio();
        audioEl.autoplay = true;
        audioElRef.current = audioEl;

        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        ctxRef.current = ctx;
        await ctx.resume().catch(() => {});

        pc.ontrack = (e) => {
          const [stream] = e.streams;
          audioEl.srcObject = stream;
          audioEl.play().catch(() => {});
          const src = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          src.connect(analyser);
          remoteAnalyserRef.current = analyser;
        };

        const mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled) {
          mic.getTracks().forEach((t) => t.stop());
          return;
        }
        micRef.current = mic;
        mic.getTracks().forEach((t) => pc.addTrack(t, mic));
        const micSrc = ctx.createMediaStreamSource(mic);
        const micAnalyser = ctx.createAnalyser();
        micAnalyser.fftSize = 512;
        micSrc.connect(micAnalyser);
        micAnalyserRef.current = micAnalyser;

        // Data channel carries events — incl. the model's tool (function) calls.
        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;
        dc.onopen = () => debug("datachannel open");
        dc.onclose = () => debug("datachannel closed");
        dc.onerror = (e) => debug("datachannel error", e);
        dc.onmessage = (e) => handleEvent(e.data);

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sdpRes = await fetch(`${CALLS_URL}?model=${encodeURIComponent(model)}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/sdp" },
          body: offer.sdp,
        });
        if (!sdpRes.ok) throw new Error(l("Връзката се провали.", "Connection failed."));
        const answer = await sdpRes.text();
        if (cancelled) return;
        await pc.setRemoteDescription({ type: "answer", sdp: answer });

        pc.onconnectionstatechange = () => {
          if (cancelled) return;
          if (pc.connectionState === "connected") {
            setStatusOnce("listening");
            lastActiveRef.current = performance.now();
          } else if (["failed", "disconnected"].includes(pc.connectionState)) {
            setError(l("Връзката прекъсна.", "The connection dropped."));
            setStatusOnce("error");
          }
        };

        lastActiveRef.current = performance.now();
        rafRef.current = requestAnimationFrame(monitor);
        idleRef.current = setInterval(() => {
          if (!cancelled && performance.now() - lastActiveRef.current > INACTIVITY_MS) {
            void closeRef.current();
          }
        }, 5000);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : l("Нещо се обърка.", "Something went wrong."));
        setStatusOnce("error");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      clearInterval(idleRef.current);
      micRef.current?.getTracks().forEach((t) => t.stop());
      pcRef.current?.getSenders().forEach((s) => s.track?.stop());
      pcRef.current?.close();
      if (audioElRef.current) audioElRef.current.srcObject = null;
      ctxRef.current?.close().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    micRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
  };

  const statusText = error
    ? error
    : status === "connecting"
      ? l("Свързване…", "Connecting…")
      : muted
        ? l("Микрофонът е изключен", "Microphone off")
        : status === "speaking"
          ? l("Ало говори…", "Alo is speaking…")
          : l("Слушам…", "Listening…");

  return (
    <div className="live-talk" role="group" aria-label={l("Говори с Ало", "Talk to Alo")}>
      <div
        className={`live-orb ${status}`}
        style={{ transform: `scale(${1 + level * 0.3})` }}
        aria-hidden="true"
      />
      <p className="live-status">{statusText}</p>

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
          onClick={() => void closeRef.current()}
        >
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}
