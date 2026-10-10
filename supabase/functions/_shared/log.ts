// Structured JSON logging. Sensitive keys are redacted so PINs, secrets and
// email/task content never reach the logs.
const SENSITIVE = /pin|secret|key|token|authorization|password|summary|result|prompt|instruction|content|message|email/i;

type Fields = Record<string, unknown>;

function redact(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = SENSITIVE.test(k) && v != null ? "[redacted]" : v;
  }
  return out;
}

function write(level: "info" | "warn" | "error", event: string, fields: Fields = {}) {
  const line = JSON.stringify({ level, event, ts: new Date().toISOString(), ...redact(fields) });
  if (level === "error") console.error(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};

/** Error text that is safe to log/store: message only, truncated. */
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 500);
}
