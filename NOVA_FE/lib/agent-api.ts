// Client for the real Spring Boot agent endpoints (/api/agent/*), proxied to
// :8080 by next.config rewrites. These are session-authenticated, so the chat
// bootstraps a real backend session from the app's phone/name before its first
// message (the rest of the app's auth is simulated client-side).

export interface PendingAction {
  type: string;
  summary: string;
}

export interface AgentResponse {
  reply: string;
  pending: PendingAction | null;
}

export class AgentError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AgentError";
    this.status = status;
  }
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // Network / connection refused (backend not running).
    throw new AgentError(0, "offline");
  }
  if (!res.ok) {
    // The backend returns { "error": "..." } for every failure — surface it.
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") message = body.error;
    } catch {
      /* non-JSON body */
    }
    throw new AgentError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Ensure a backend session exists for this phone: log in, else register. */
export async function ensureSession(phoneE164: string, name: string): Promise<void> {
  try {
    await postJson("/api/auth/login", { phone: phoneE164 });
    return;
  } catch (err) {
    if (!(err instanceof AgentError) || err.status !== 404) throw err;
  }
  // No account yet — register one, then we're logged in.
  try {
    await postJson("/api/auth/register", { phone: phoneE164, name: name || "Ало" });
  } catch (err) {
    // Race: already registered — fall back to login.
    if (err instanceof AgentError && err.status === 409) {
      await postJson("/api/auth/login", { phone: phoneE164 });
      return;
    }
    throw err;
  }
}

export const sendChat = (message: string) =>
  postJson<AgentResponse>("/api/agent/chat", { message });

export const confirmAction = (approved: boolean) =>
  postJson<AgentResponse>("/api/agent/confirm", { approved });

export const resetChat = () => postJson<void>("/api/agent/reset");
