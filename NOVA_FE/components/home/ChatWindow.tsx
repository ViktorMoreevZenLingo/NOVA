"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { Icon } from "@/components/ui/Icon";
import {
  confirmAction,
  loadChat,
  resetChat,
  sendChat,
  type PendingAction,
} from "@/lib/agent-api";

interface Message {
  role: "user" | "alo";
  text: string;
}

export function ChatWindow({
  phoneE164,
  userName,
}: {
  phoneE164: string;
  userName: string;
}) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setBusy(true);
    loadChat()
      .then((data) => {
        if (active) {
          setMessages(data.messages);
          setPending(data.pending);
        }
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages, pending, busy]);

  const describeError = (err: unknown) =>
    err instanceof Error
      ? err.message
      : l(
          "Нещо се обърка. Опитай пак.",
          "Something went wrong. Please try again.",
        );

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", text: message }]);
    setBusy(true);
    try {
      const res = await sendChat(message);
      setPending(res.pending);
      if (!res.pending && res.reply)
        setMessages((m) => [...m, { role: "alo", text: res.reply }]);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const resolve = async (approved: boolean) => {
    if (busy || !pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await confirmAction(approved, pending!.id);
      setPending(res.pending);
      if (res.reply)
        setMessages((m) => [...m, { role: "alo", text: res.reply }]);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await resetChat();
      setMessages([]);
      setPending(null);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  const suggestions = [
    l("Какво имам в календара утре?", "What’s on my calendar tomorrow?"),
    l("Прочети последните ми имейли", "Read my latest emails"),
    l("Намери телефона на Иван", "Find Ivan’s phone number"),
  ];

  return (
    <section
      className="chat-window"
      aria-label={l("Разговор с Ало", "Chat with Alo")}
    >
      <div className="chat-window-header">
        <h2>{l("Говори с Ало", "Talk to Alo")}</h2>
        {(messages.length > 0 || pending) && (
          <button type="button" className="text-button" onClick={reset}>
            {l("Изчисти", "Clear")}
          </button>
        )}
      </div>

      <div className="chat-log" ref={logRef} role="log" aria-live="polite">
        {messages.length === 0 && !busy ? (
          <div className="chat-empty">
            <p>
              {l(
                "Попитай Ало нещо — например:",
                "Ask Alo something — for example:",
              )}
            </p>
            <div className="chat-suggestions">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="chat-suggestion"
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div
                key={i}
                className={`transcript-turn ${m.role === "user" ? "outgoing" : "incoming"}`}
              >
                <p className="chat-bubble">{m.text}</p>
                <span className="chat-caption">
                  {m.role === "user" ? l("Ти", "You") : l("Ало", "Alo")}
                </span>
              </div>
            ))}
            {busy && (
              <p className="chat-typing">{l("Ало пише…", "Alo is typing…")}</p>
            )}
          </>
        )}
      </div>

      {pending && (
        <div className="chat-pending">
          <span className="pending-summary">
            <strong>{l("Потвърди действието:", "Confirm this action:")}</strong>{" "}
            {pending.summary}
          </span>
          <span className="chat-pending-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => resolve(false)}
            >
              {l("Откажи", "Reject")}
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => resolve(true)}
            >
              {l("Потвърди", "Approve")}
            </button>
          </span>
        </div>
      )}

      {error && (
        <p className="chat-error" role="alert">
          {error}
        </p>
      )}

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          type="text"
          value={input}
          placeholder={l("Напиши съобщение…", "Type a message…")}
          aria-label={l("Съобщение до Ало", "Message to Alo")}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button
          type="submit"
          className="primary chat-send"
          aria-label={l("Изпрати", "Send")}
          disabled={busy || !input.trim()}
        >
          <Icon name="arrow" />
        </button>
      </form>
    </section>
  );
}
