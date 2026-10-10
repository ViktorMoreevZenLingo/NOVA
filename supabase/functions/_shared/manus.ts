// Manus API v2 client + webhook signature verification.
// Docs: https://open.manus.ai/docs/v2 (task.create, task.detail, task.listMessages,
// webhook.publicKey, webhooks-security).
import type { ManusTaskInput } from "./contracts.ts";
import { sha256Hex } from "./crypto.ts";

const DEFAULT_BASE_URL = "https://api.manus.ai/v2";
const REQUEST_TIMEOUT_MS = 15_000;
const SIGNATURE_MAX_AGE_S = 300;

export type ManusTaskStatus = "running" | "stopped" | "waiting" | "error";

export type ManusTask = {
  id: string;
  status: ManusTaskStatus;
  task_url?: string;
  has_running_background_jobs?: boolean;
};

export type ManusClient = {
  createTask(
    input: ManusTaskInput,
    title: string,
    structuredOutputSchema?: Record<string, unknown>,
  ): Promise<{ taskId: string; taskUrl: string | null }>;
  getTask(taskId: string): Promise<ManusTask>;
  /** Text of the newest assistant message (the final answer once the task stopped). */
  latestAssistantMessage(taskId: string): Promise<string | null>;
  /** Structured output (when created with a schema), for when the webhook was missed. */
  latestStructuredOutput(taskId: string): Promise<Record<string, unknown> | null>;
  /** Newest error_message event, if the task errored. */
  latestError(taskId: string): Promise<string | null>;
  /** Cached for 1h; `refresh` forces a refetch (key rotation). */
  publicKeyPem(refresh?: boolean): Promise<string>;
};

export class ManusApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

type TaskEvent = {
  type: string;
  structured_output_result?: { success?: boolean; value?: Record<string, unknown> };
  assistant_message?: { content?: string };
  error_message?: { content?: string };
};

export function createManusClient(apiKey: string, baseUrl = DEFAULT_BASE_URL): ManusClient {
  async function request<T>(
    method: "GET" | "POST",
    path: string,
    opts: { query?: Record<string, string>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(`${baseUrl}/${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const res = await fetch(url, {
      method,
      headers: { "x-manus-api-key": apiKey, "content-type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      const code = json?.error?.code;
      const message = json?.error?.message ?? `HTTP ${res.status}`;
      throw new ManusApiError(`Manus ${path} failed: ${code ?? ""} ${message}`.trim(), res.status, code);
    }
    return json as T;
  }

  async function latestEvent(taskId: string, type: string): Promise<TaskEvent | undefined> {
    const res = await request<{ messages: TaskEvent[] }>("GET", "task.listMessages", {
      query: { task_id: taskId, order: "desc", limit: "50" },
    });
    return res.messages.find((m) => m.type === type);
  }

  let cachedKey: { pem: string; fetchedAt: number } | null = null;

  return {
    async createTask(input, title, structuredOutputSchema) {
      const res = await request<{ task_id: string; task_url?: string }>("POST", "task.create", {
        body: {
          message: { content: input.content, connectors: input.connectors },
          title,
          interactive_mode: false,
          agent_profile: "standard",
          ...(structuredOutputSchema ? { structured_output_schema: structuredOutputSchema } : {}),
        },
      });
      return { taskId: res.task_id, taskUrl: res.task_url ?? null };
    },

    async getTask(taskId) {
      const res = await request<{ task: ManusTask }>("GET", "task.detail", { query: { task_id: taskId } });
      return res.task;
    },

    async latestAssistantMessage(taskId) {
      return (await latestEvent(taskId, "assistant_message"))?.assistant_message?.content ?? null;
    },

    async latestStructuredOutput(taskId) {
      const result = (await latestEvent(taskId, "structured_output_result"))?.structured_output_result;
      return result?.success === false ? null : result?.value ?? null;
    },

    async latestError(taskId) {
      return (await latestEvent(taskId, "error_message"))?.error_message?.content ?? null;
    },

    async publicKeyPem(refresh = false) {
      // Cache for 1h as recommended by the Manus docs.
      if (!refresh && cachedKey && Date.now() - cachedKey.fetchedAt < 3_600_000) return cachedKey.pem;
      const res = await request<{ public_key: string }>("GET", "webhook.publicKey");
      cachedKey = { pem: res.public_key, fetchedAt: Date.now() };
      return res.public_key;
    },
  };
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const b64 = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Verifies a Manus webhook: RSA-SHA256 (PKCS#1 v1.5) over
 * `{timestamp}.{url}.{sha256_hex(rawBody)}`, timestamp within 5 minutes.
 * `url` must be the exact URL registered with Manus (not req.url).
 */
export async function verifyManusSignature(params: {
  publicKeyPem: string;
  url: string;
  rawBody: string;
  signatureB64: string;
  timestamp: string;
  nowSeconds?: number;
}): Promise<boolean> {
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ts = Number(params.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > SIGNATURE_MAX_AGE_S) return false;

  try {
    const key = await crypto.subtle.importKey(
      "spki",
      pemToDer(params.publicKeyPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signed = `${params.timestamp}.${params.url}.${await sha256Hex(params.rawBody)}`;
    const b64 = params.signatureB64.replace(/-/g, "+").replace(/_/g, "/"); // accept base64url too
    const signature: Uint8Array<ArrayBuffer> = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, new TextEncoder().encode(signed));
  } catch {
    return false;
  }
}

/** Manus `task_stopped` webhook payload (only the fields we use). */
export type ManusWebhookEvent = {
  event_id: string;
  event_type: "task_created" | "task_stopped" | string;
  task_detail?: {
    task_id: string;
    task_title?: string;
    task_url?: string;
    message?: string;
    stop_reason?: "finish" | "ask";
    /** Present when the task was created with structured_output_schema. */
    structured_output?: { success?: boolean; value?: Record<string, unknown>; error?: string | null };
  };
};
