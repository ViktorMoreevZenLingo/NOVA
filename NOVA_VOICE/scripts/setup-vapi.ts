// Idempotent Vapi setup: creates or updates the three tools and the "Alo" assistant
// from NOVA_VOICE/vapi/*.json, and attaches the assistant to a Vapi phone number.
// Runs in .github/workflows/setup-vapi.yml (secrets stay in GitHub):
//   VAPI_API_KEY (private key), VAPI_TOOL_SECRET, SUPABASE_PROJECT_REF, optional VAPI_PHONE_NUMBER_ID
// Locally: same env vars, then `deno run --allow-env --allow-read --allow-net=api.vapi.ai scripts/setup-vapi.ts`
const API = "https://api.vapi.ai";
const env = (name: string, required = true) => {
  const value = Deno.env.get(name);
  if (required && !value) throw new Error(`Missing ${name}`);
  return value ?? "";
};
const apiKey = env("VAPI_API_KEY");
const toolSecret = env("VAPI_TOOL_SECRET");
const projectRef = env("SUPABASE_PROJECT_REF");
const wantedNumber = env("VAPI_PHONE_NUMBER_ID", false);
const dir = new URL("../vapi/", import.meta.url);

async function vapi(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Fill placeholders; tools authenticate with the x-vapi-secret header. */
async function load(file: string) {
  const raw = await Deno.readTextFile(new URL(file, dir));
  return JSON.parse(raw.replaceAll("<project-ref>", projectRef).replaceAll("<VAPI_TOOL_SECRET>", toolSecret));
}

// ---- tools
const existingTools: { id: string; function?: { name?: string } }[] = await vapi("GET", "/tool?limit=100");
const toolIds: Record<string, string> = {};
for (const file of ["tool-create-task.json", "tool-get-task-status.json", "tool-decide-action.json"]) {
  const tool = await load(file);
  delete tool.server.credentialId;
  const name = tool.function.name as string;
  const found = existingTools.find((t) => t.function?.name === name);
  const { type: _type, ...patch } = tool;
  const saved = found ? await vapi("PATCH", `/tool/${found.id}`, patch) : await vapi("POST", "/tool", tool);
  toolIds[name] = saved.id;
  console.log(`tool ${name}: ${found ? "updated" : "created"} ${saved.id}`);
}

// ---- assistant
const assistant = await load("assistant.json");
assistant.model.toolIds = [toolIds.create_task, toolIds.get_task_status, toolIds.decide_action];
const existingAssistants: { id: string; name?: string }[] = await vapi("GET", "/assistant?limit=100");
const foundAssistant = existingAssistants.find((a) => a.name === assistant.name);
const savedAssistant = foundAssistant
  ? await vapi("PATCH", `/assistant/${foundAssistant.id}`, assistant)
  : await vapi("POST", "/assistant", assistant);
console.log(`assistant ${assistant.name}: ${foundAssistant ? "updated" : "created"} ${savedAssistant.id}`);

// ---- phone number
const numbers: { id: string; number?: string; provider?: string; assistantId?: string }[] = await vapi("GET", "/phone-number?limit=100");
const number = wantedNumber ? numbers.find((n) => n.id === wantedNumber) : numbers[0];
if (!number) {
  console.log("No Vapi phone number found: create one in the Vapi dashboard (Phone Numbers), then run this again.");
} else {
  await vapi("PATCH", `/phone-number/${number.id}`, { assistantId: savedAssistant.id });
  const masked = (number.number ?? "").replace(/^(\+\d{3})\d+(\d{2})$/, "$1•••$2");
  console.log(`phone number ${number.id} (${number.provider ?? "?"} ${masked}) → assistant ${savedAssistant.id}`);
}
