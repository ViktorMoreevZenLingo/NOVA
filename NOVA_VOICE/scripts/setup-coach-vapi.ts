// Idempotent Vapi setup for the NOVA Coach and NOVA Pulse assistants. Instructions and tool
// schemas come from supabase/functions/_shared/coach/prompts.ts (single source of truth);
// vapi/{coach,pulse}-assistant.json only hold model/voice/transcriber settings.
// Required: VAPI_API_KEY, VAPI_TOOL_SECRET, and SUPABASE_PROJECT_REF or COACH_TOOLS_URL (e.g. a local tunnel for demos).
// Prints the assistant ids to store as VAPI_COACH_ASSISTANT_ID / VAPI_PULSE_ASSISTANT_ID.
// Optional VAPI_COACH_PHONE_NUMBER_ID: attach the coach to a dedicated inbound number.
import {
  COACH_FIRST_MESSAGE,
  COACH_INSTRUCTIONS,
  COACH_TOOLS,
  PULSE_FIRST_MESSAGE,
  PULSE_INSTRUCTIONS,
  PULSE_TOOLS,
  type ToolSchema,
} from "../../supabase/functions/_shared/coach/prompts.ts";

const API = "https://api.vapi.ai";
const env = (name: string, required = true) => {
  const value = Deno.env.get(name);
  if (required && !value) throw new Error(`Missing ${name}`);
  return value ?? "";
};
const apiKey = env("VAPI_API_KEY");
const toolSecret = env("VAPI_TOOL_SECRET");
const toolUrlOverride = env("COACH_TOOLS_URL", false);
const projectRef = toolUrlOverride ? "" : env("SUPABASE_PROJECT_REF");
const coachNumber = env("VAPI_COACH_PHONE_NUMBER_ID", false);
const toolUrl = toolUrlOverride || `https://${projectRef}.supabase.co/functions/v1/coach-tools`;

async function vapi(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const existingTools: { id: string; function?: { name?: string }; server?: { url?: string } }[] = await vapi("GET", "/tool?limit=100");
async function upsertTools(tools: ToolSchema[]): Promise<string[]> {
  const ids: string[] = [];
  for (const t of tools) {
    const spec = {
      type: "function",
      async: false,
      function: { name: t.name, description: t.description, parameters: t.parameters },
      server: { url: toolUrl, timeoutSeconds: 30, headers: { "x-vapi-secret": toolSecret } },
    };
    const found = existingTools.find((e) => e.function?.name === t.name && e.server?.url === toolUrl);
    const { type: _type, ...patch } = spec;
    const saved = found ? await vapi("PATCH", `/tool/${found.id}`, patch) : await vapi("POST", "/tool", spec);
    ids.push(saved.id);
    console.log(`tool ${t.name}: ${found ? "updated" : "created"}`);
  }
  return ids;
}

const assistants: { id: string; name?: string }[] = await vapi("GET", "/assistant?limit=100");
async function upsertAssistant(file: string, instructions: string, firstMessage: string, tools: ToolSchema[]) {
  const template = JSON.parse(await Deno.readTextFile(new URL(`../vapi/${file}`, import.meta.url)));
  const toolIds = await upsertTools(tools);
  const body = {
    ...template,
    firstMessage,
    model: { ...template.model, toolIds, messages: [{ role: "system", content: instructions }] },
    // Outbound follow-ups override firstMessage per call (see _shared/coach/outbound.ts).
    firstMessageMode: "assistant-speaks-first",
  };
  const found = assistants.find((a) => a.name === template.name);
  const saved = found ? await vapi("PATCH", `/assistant/${found.id}`, body) : await vapi("POST", "/assistant", body);
  const verified = await vapi("GET", `/assistant/${saved.id}`);
  if (toolIds.some((id) => !verified.model?.toolIds?.includes(id))) throw new Error(`${template.name}: tools were not attached`);
  console.log(`${template.name}: ${found ? "updated" : "created"} ${saved.id}`);
  return saved.id as string;
}

const coachId = await upsertAssistant("coach-assistant.json", COACH_INSTRUCTIONS, COACH_FIRST_MESSAGE, COACH_TOOLS);
const pulseId = await upsertAssistant("pulse-assistant.json", PULSE_INSTRUCTIONS, PULSE_FIRST_MESSAGE, PULSE_TOOLS);
if (coachNumber) {
  await vapi("PATCH", `/phone-number/${coachNumber}`, { assistantId: coachId });
  console.log(`inbound number ${coachNumber} → NOVA Coach`);
}
console.log(`\nVAPI_COACH_ASSISTANT_ID=${coachId}\nVAPI_PULSE_ASSISTANT_ID=${pulseId}`);
