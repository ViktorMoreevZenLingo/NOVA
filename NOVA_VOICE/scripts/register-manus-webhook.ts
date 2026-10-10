// Idempotent Manus setup: registers MANUS_WEBHOOK_URL (if not registered yet)
// and prints the installed connectors (to find the Gmail connector id).
// Runs in the deploy workflow; locally:
//   MANUS_API_KEY=... MANUS_WEBHOOK_URL=https://<ref>.supabase.co/functions/v1/manus-webhook \
//     deno run --allow-env --allow-net scripts/register-manus-webhook.ts
const BASE = "https://api.manus.ai/v2";
const apiKey = Deno.env.get("MANUS_API_KEY");
const webhookUrl = Deno.env.get("MANUS_WEBHOOK_URL");
if (!apiKey || !webhookUrl) {
  console.error("Set MANUS_API_KEY and MANUS_WEBHOOK_URL");
  Deno.exit(1);
}

async function call(method: "GET" | "POST", path: string, body?: unknown) {
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
console.log("Connectors on this Manus account:");
for (const c of connectors.data ?? connectors.connectors ?? []) {
  console.log(`  ${c.id ?? c.uuid}  ${c.name ?? c.title ?? ""}  ${c.status ?? ""}`);
}

const { data: webhooks = [] } = await call("GET", "webhook.list");
const existing = webhooks.find((w: { url: string }) => w.url === webhookUrl);
if (existing) {
  console.log(`Webhook already registered: ${existing.id} (${existing.status})`);
} else {
  const { webhook } = await call("POST", "webhook.create", { url: webhookUrl });
  console.log(`Webhook registered: ${webhook.id} (${webhook.status})`);
}
