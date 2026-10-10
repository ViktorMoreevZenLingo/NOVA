// Vapi REST client (private API key) for outbound callbacks.
// Docs: https://docs.vapi.ai/api-reference/calls/create

export type VapiApi = {
  /** Starts an outbound call with our assistant; returns the new call id. */
  startCall(params: { phone: string; firstMessage: string; metadata: Record<string, string> }): Promise<string>;
};

export type VapiApiConfig = { apiKey: string; assistantId: string; phoneNumberId: string };

export function createVapiApi(config: VapiApiConfig): VapiApi {
  return {
    async startCall({ phone, firstMessage, metadata }) {
      const res = await fetch("https://api.vapi.ai/call", {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          assistantId: config.assistantId,
          phoneNumberId: config.phoneNumberId,
          customer: { number: phone },
          name: "Alo secure callback",
          assistantOverrides: { firstMessage },
          metadata,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || typeof json?.id !== "string") throw new Error(`Vapi call.create failed: HTTP ${res.status}`);
      return json.id;
    },
  };
}

/** Null when callbacks aren't configured: L3 requests are then refused, never skipped. */
export function vapiApiFromEnv(): VapiApi | null {
  const apiKey = Deno.env.get("VAPI_API_KEY");
  const assistantId = Deno.env.get("VAPI_ASSISTANT_ID");
  const phoneNumberId = Deno.env.get("VAPI_PHONE_NUMBER_ID");
  return apiKey && assistantId && phoneNumberId ? createVapiApi({ apiKey, assistantId, phoneNumberId }) : null;
}
