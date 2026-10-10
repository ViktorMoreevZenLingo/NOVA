"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n-context";
import { taskRequest, type DelegatedTask } from "@/lib/tasks-api";
export function TaskControls({
  id,
  summary,
  onUpdated,
}: {
  id: string;
  summary?: string;
  onUpdated: () => void;
}) {
  const { lang } = useI18n();
  const l = (bg: string, en: string) => (lang === "bg" ? bg : en);
  const updated = useRef(onUpdated);
  updated.current = onUpdated;
  const [task, setTask] = useState<DelegatedTask | null>(null),
    [answer, setAnswer] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    let revision: number | undefined;
    setTask(null);
    setError("");
    const load = () =>
      taskRequest("get", id)
        .then((t) => {
          if (live) {
            setTask(t);
            if (revision !== undefined && revision !== t.revision) updated.current();
            revision = t.revision;
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id]);
  const act = async (action: string) => {
    if (!task) return;
    setBusy(true);
    setError("");
    try {
      setTask(
        await taskRequest(action, id, {
          revision: task.revision,
          ...(action === "respond"
            ? { answer: answer.trim() || "The connection is ready. Continue." }
            : {}),
        }),
      );
      setAnswer("");
      onUpdated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };
  const pending = task?.pending;
  const description = task
    ? task.error || task.result || (!pending ? task.instruction : "")
    : summary;
  const displayDescription = description === "Manus returned an unsupported or malformed tool request."
    ? l("Задачата не беше завършена, защото полученият отговор не може да бъде обработен.", "The task could not finish because its response could not be processed.")
    : description;
  return (
    <div className="task-controls" aria-busy={busy}>
      {displayDescription && <p className="history-summary task-summary" role={task?.error ? "status" : undefined}>{displayDescription}</p>}
      {task?.run_at && (
        <p>
          {l("Насрочена за", "Scheduled for")}{" "}
          {new Intl.DateTimeFormat(lang === "bg" ? "bg-BG" : "en-GB", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: task.timezone,
          }).format(new Date(task.run_at))}{" "}
          · {task.timezone}
        </p>
      )}
      {pending && (
        <div className="task-response">
          <p>{pending.question}</p>
          {pending.kind === "approval" ? (
            <>
              <strong>
                {pending.tool === "create_calendar_event"
                  ? l("Създаване на събитие", "Create calendar event")
                  : pending.tool === "create_email_draft"
                    ? l("Запазване на чернова", "Save email draft")
                    : l("Изпращане на имейл", "Send email")}
              </strong>
              <dl>
                {Object.entries(pending.args || {}).map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      {(
                        {
                          to: l("До", "To"),
                          cc: l("Копие", "Cc"),
                          subject: l("Тема", "Subject"),
                          body: l("Съобщение", "Message"),
                          title: l("Заглавие", "Title"),
                          start: l("Начало", "Start"),
                          end: l("Край", "End"),
                          description: l("Описание", "Description"),
                          location: l("Място", "Location"),
                          attendees: l("Участници", "Guests"),
                        } as Record<string, string>
                      )[k] || k}
                    </dt>
                    <dd>{Array.isArray(v) ? v.join(", ") : String(v)}</dd>
                  </div>
                ))}
              </dl>
              <button
                className="primary options-button"
                disabled={busy}
                onClick={() => act("approve")}
              >
                {l("Одобри действието", "Approve action")}
              </button>
            </>
          ) : pending.kind === "connection" ? (
            <button
              className="primary options-button"
              disabled={busy}
              onClick={() => act("respond")}
            >
              {l("Продължи след свързване", "Continue after connecting")}
            </button>
          ) : pending.kind !== "uncertain" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act("respond");
              }}
            >
              <label htmlFor="task-answer">
                {l("Твоят отговор", "Your answer")}
              </label>
              <textarea
                id="task-answer"
                maxLength={4000}
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                required
              />
              <button
                className="primary options-button"
                disabled={busy || !answer.trim()}
              >
                {l("Продължи", "Continue")}
              </button>
            </form>
          ) : null}
        </div>
      )}
      {task && !["completed", "cancelled", "failed"].includes(task.status) && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => act("cancel")}
        >
          {l("Отмени задачата", "Cancel task")}
        </button>
      )}
      {task?.deliveries?.map((d) => (
        <p key={d.channel}>
          {d.channel}: {d.status}
          {d.error ? ` — ${d.error}` : ""}
        </p>
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
