// Explicit, idempotent Vapi setup. Preserves an existing assistant's voice/model and adds Alo cloud tools.
// Required: VAPI_API_KEY, VAPI_TOOL_SECRET (or VAPI_DELEGATION_SECRET), SUPABASE_PROJECT_REF.
// Optional: VAPI_PHONE_NUMBER_ID, VAPI_ASSISTANT_ID. Ambiguous phone selection is rejected.
const API = "https://api.vapi.ai";
const env = (name: string, required = true) => {
  const value = Deno.env.get(name);
  if (required && !value) throw new Error(`Missing ${name}`);
  return value ?? "";
};
const apiKey = env("VAPI_API_KEY");
const toolSecret = env("VAPI_DELEGATION_SECRET", false) || env("VAPI_TOOL_SECRET");
const projectRef = env("SUPABASE_PROJECT_REF");
const wantedNumber = env("VAPI_PHONE_NUMBER_ID", false);
const dir = new URL("../vapi/", import.meta.url);
async function vapi(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  return res.json();
}
async function load(file: string) {
  const raw = await Deno.readTextFile(new URL(file, dir));
  return JSON.parse(raw.replaceAll("<project-ref>", projectRef).replaceAll("<VAPI_TOOL_SECRET>", toolSecret));
}
const numbers: { id: string; assistantId?: string }[] = await vapi("GET", "/phone-number?limit=100");
if (!wantedNumber && numbers.length > 1) throw new Error("Set VAPI_PHONE_NUMBER_ID to choose the number explicitly.");
const number = wantedNumber ? numbers.find((n) => n.id === wantedNumber) : numbers[0];
if (wantedNumber && !number) throw new Error("VAPI_PHONE_NUMBER_ID was not found.");
const assistantId = env("VAPI_ASSISTANT_ID", false) || number?.assistantId;
const existing = assistantId ? await vapi("GET", `/assistant/${assistantId}`) : null;
const existingTools: { id: string; function?: { name?: string }; server?: { url?: string } }[] = await vapi("GET", "/tool?limit=100");
const toolIds: string[] = [];
for (
  const file of [
    "tool-create-task.json",
    "tool-get-task-status.json",
    "tool-decide-action.json",
    "tool-cancel-task.json",
    "tool-respond-to-task.json",
  ]
) {
  const tool = await load(file);
  const found = existingTools.find((t) => t.function?.name === tool.function.name && t.server?.url === tool.server.url);
  const { type: _type, ...patch } = tool;
  const saved = found ? await vapi("PATCH", `/tool/${found.id}`, patch) : await vapi("POST", "/tool", tool);
  toolIds.push(saved.id);
  console.log(`tool ${tool.function.name}: ${found ? "updated" : "created"}`);
}
const template = await load("assistant.json");
const marker = "ALO CLOUD TASK EXECUTION";
const model = existing?.model ?? template.model;
model.toolIds = [...new Set([...(existing?.model?.toolIds ?? []), ...toolIds])];
model.messages = [
  ...(existing?.model?.messages ?? []).filter((m: { role: string; content?: string }) =>
    !(m.role === "system" && m.content?.startsWith(marker))
  ),
  { role: "system", content: `${marker}\n${template.model.messages[0].content}\nKeep the existing caller language preference.` },
];
const changes = {
  model,
  server: template.server,
  serverMessages: [...new Set([...(existing?.serverMessages ?? []), "tool-calls", "end-of-call-report"])],
};
const saved = existing
  ? await vapi("PATCH", `/assistant/${existing.id}`, changes)
  : await vapi("POST", "/assistant", { ...template, ...changes });
console.log(`assistant configured: ${saved.id}`);
if (number && number.assistantId !== saved.id) await vapi("PATCH", `/phone-number/${number.id}`, { assistantId: saved.id });
