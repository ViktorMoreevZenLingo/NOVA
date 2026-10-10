// One-off setup helper. Usage:
//   MANUS_API_KEY=... MANUS_WEBHOOK_URL=https://<ref>.supabase.co/functions/v1/manus-webhook \
//     deno run --allow-env --allow-net scripts/register-manus-webhook.ts
// Lists connectors (to find the Gmail connector id) and registers the webhook.
const BASE = "https://api.manus.ai/v2";
const apiKey = Deno.env.get("MANUS_API_KEY");
const webhookUrl = Deno.env.get("MANUS_WEBHOOK_URL");
if (!apiKey || !webhookUrl) {
  console.error("Set MANUS_API_KEY and MANUS_WEBHOOK_URL");
  Deno.exit(1);
}

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: { "x-manus-api-key": apiKey!, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(`${path}: HTTP ${res.status} ${JSON.stringify(json.error ?? json)}`);
  return json;
}

const connectors = await call("GET", "connector.list");
console.log("Connectors installed on this Manus account:");
console.log(JSON.stringify(connectors, null, 2));

const { webhook } = await call("POST", "webhook.create", { url: webhookUrl });
console.log(`Webhook registered: ${webhook.id} -> ${webhook.url} (${webhook.status})`);
