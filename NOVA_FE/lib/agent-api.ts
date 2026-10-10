// Client for the real Spring Boot backend (proxied to :8080 by next.config
// rewrites): the agent endpoints (/api/agent/*) and the pieces needed to wire
// real Google integrations (session + /api/me + /api/google/*). These are
// session-authenticated, so the app bootstraps a real session from its
// phone/name before using them (the rest of the app's auth is simulated).

export interface PendingAction {
  type: string;
  summary: string;
}

export interface AgentResponse {
  reply: string;
  pending: PendingAction | null;
}

export interface MeServices {
  calendar: boolean;
  contacts: boolean;
  gmail: boolean;
}

export interface Me {
  phone: string;
  name: string;
  about: string;
  services: MeServices;
}

export type GoogleService = keyof MeServices;

export class AgentError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AgentError";
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
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
      const data = await res.json();
      if (data && typeof data.error === "string") message = data.error;
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
    await request("POST", "/api/auth/login", { phone: phoneE164 });
    return;
  } catch (err) {
    if (!(err instanceof AgentError) || err.status !== 404) throw err;
  }
  // No account yet — register one, then we're logged in.
  try {
    await request("POST", "/api/auth/register", { phone: phoneE164, name: name || "Ало" });
  } catch (err) {
    // Race: already registered — fall back to login.
    if (err instanceof AgentError && err.status === 409) {
      await request("POST", "/api/auth/login", { phone: phoneE164 });
      return;
    }
    throw err;
  }
}

export const getMe = () => request<Me>("GET", "/api/me");

export const disconnectGoogle = (service: GoogleService) =>
  request<void>("DELETE", `/api/google/${service}`);

/** URL for a full-page navigation that starts the real Google OAuth flow. */
export const googleConnectUrl = (service: GoogleService) =>
  `/api/google/connect?service=${encodeURIComponent(service)}`;

export const sendChat = (message: string) =>
  request<AgentResponse>("POST", "/api/agent/chat", { message });

export const confirmAction = (approved: boolean) =>
  request<AgentResponse>("POST", "/api/agent/confirm", { approved });

export const resetChat = () => request<void>("POST", "/api/agent/reset");
