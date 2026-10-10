// Single place for all backend calls. Typed request/response objects.
//
// Two implementations behind one interface:
//  - the real client talks to the Spring Boot backend via relative /api/* paths
//    (proxied to http://localhost:8080 by next.config rewrites);
//  - the mock client (NEXT_PUBLIC_MOCK=1) keeps state in localStorage so the
//    whole flow is testable before the backend exists.

export type GoogleService = "calendar" | "contacts" | "gmail";

export interface Services {
  calendar: boolean;
  contacts: boolean;
  gmail: boolean;
}

export interface Me {
  phone: string;
  name: string;
  about: string;
  services: Services;
}

export interface UpdateMeInput {
  name: string;
  about: string;
}

/** Error carrying the HTTP status so callers can branch on 401/404/409. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface Api {
  readonly isMock: boolean;
  getMe(): Promise<Me>;
  login(phone: string): Promise<void>;
  register(phone: string, name: string): Promise<void>;
  logout(): Promise<void>;
  updateMe(input: UpdateMeInput): Promise<Me>;
  /** URL used for a full-page navigation to start Google OAuth (real mode). */
  getConnectUrl(service: GoogleService): string;
  /** Mock mode only: toggles the service on without leaving the page. */
  connectGoogle(service: GoogleService): Promise<void>;
  disconnectGoogle(service: GoogleService): Promise<void>;
}

const MOCK = process.env.NEXT_PUBLIC_MOCK === "1";

function connectUrl(service: GoogleService): string {
  return `/api/google/connect?service=${encodeURIComponent(service)}`;
}

// ---------------------------------------------------------------------------
// Real client
// ---------------------------------------------------------------------------

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    throw new ApiError(res.status);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

const realApi: Api = {
  isMock: false,
  getMe: () => request<Me>("/api/me"),
  login: (phone) =>
    request<void>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ phone }),
    }),
  register: (phone, name) =>
    request<void>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ phone, name }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  updateMe: (input) =>
    request<Me>("/api/me", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  getConnectUrl: connectUrl,
  connectGoogle: async (service) => {
    // Not used by the UI in real mode (the page navigates instead), but kept
    // consistent as a fallback.
    if (typeof window !== "undefined") {
      window.location.href = connectUrl(service);
    }
  },
  disconnectGoogle: (service) =>
    request<void>(`/api/google/${service}`, { method: "DELETE" }),
};

// ---------------------------------------------------------------------------
// Mock client (localStorage-backed)
// ---------------------------------------------------------------------------

const MOCK_KEY = "alo.mock.v1";

interface MockState {
  users: Record<string, Me>;
  session: string | null;
}

function loadMock(): MockState {
  try {
    const raw = localStorage.getItem(MOCK_KEY);
    if (raw) {
      return JSON.parse(raw) as MockState;
    }
  } catch {
    // Ignore read/parse failures and start fresh.
  }
  return { users: {}, session: null };
}

function saveMock(state: MockState): void {
  try {
    localStorage.setItem(MOCK_KEY, JSON.stringify(state));
  } catch {
    // Ignore persistence failures.
  }
}

function currentUser(state: MockState): Me {
  if (!state.session || !state.users[state.session]) {
    throw new ApiError(401);
  }
  return state.users[state.session];
}

// Small delay so loading states are visible while testing.
function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

const mockApi: Api = {
  isMock: true,
  getMe: async () => {
    await delay();
    const state = loadMock();
    return currentUser(state);
  },
  login: async (phone) => {
    await delay();
    const state = loadMock();
    if (!state.users[phone]) {
      throw new ApiError(404);
    }
    state.session = phone;
    saveMock(state);
  },
  register: async (phone, name) => {
    await delay();
    const state = loadMock();
    if (state.users[phone]) {
      throw new ApiError(409);
    }
    state.users[phone] = {
      phone,
      name,
      about: "",
      services: { calendar: false, contacts: false, gmail: false },
    };
    state.session = phone;
    saveMock(state);
  },
  logout: async () => {
    await delay();
    const state = loadMock();
    state.session = null;
    saveMock(state);
  },
  updateMe: async (input) => {
    await delay();
    const state = loadMock();
    const user = currentUser(state);
    user.name = input.name;
    user.about = input.about;
    saveMock(state);
    return user;
  },
  getConnectUrl: connectUrl,
  connectGoogle: async (service) => {
    await delay();
    const state = loadMock();
    const user = currentUser(state);
    user.services[service] = true;
    saveMock(state);
  },
  disconnectGoogle: async (service) => {
    await delay();
    const state = loadMock();
    const user = currentUser(state);
    user.services[service] = false;
    saveMock(state);
  },
};

export const api: Api = MOCK ? mockApi : realApi;
