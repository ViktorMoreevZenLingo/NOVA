// Explicit, idempotent Vapi setup. Preserves an existing assistant's voice/model and adds Alo cloud tools.
// Required: VAPI_API_KEY, VAPI_TOOL_SECRET (or VAPI_DELEGATION_SECRET), SUPABASE_PROJECT_REF.
// Optional: VAPI_PHONE_NUMBER_ID, VAPI_ASSISTANT_ID. Ambiguous phone selection is rejected.
import { configureAssistantModel } from "./assistant-model.ts";
import { definitions } from "../../supabase/functions/_shared/tools.ts";
import { READ_TOOLS } from "../../supabase/functions/_shared/delegation/direct-voice.ts";
const API = "https://api.vapi.ai";
const env = (name: string, required = true) => {
  const value = Deno.env.get(name);
  if (required && !value) throw new Error(`Missing ${name}`);
  return value ?? "";
};
const apiKey = env("VAPI_API_KEY");
const toolSecret = env("VAPI_DELEGATION_SECRET", false) ||
  env("VAPI_TOOL_SECRET");
const projectRef = env("SUPABASE_PROJECT_REF");
const wantedNumber = env("VAPI_PHONE_NUMBER_ID", false);
const dir = new URL("../vapi/", import.meta.url);
async function vapi(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "User-Agent": "Alo-Integration/1.0",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  return res.json();
}
async function load(file: string) {
  const raw = await Deno.readTextFile(new URL(file, dir));
  return JSON.parse(
    raw.replaceAll("<project-ref>", projectRef).replaceAll(
      "<VAPI_TOOL_SECRET>",
      toolSecret,
    ),
  );
}
const numbers: { id: string; assistantId?: string }[] = await vapi(
  "GET",
  "/phone-number?limit=100",
);
if (!wantedNumber && numbers.length > 1) {
  throw new Error("Set VAPI_PHONE_NUMBER_ID to choose the number explicitly.");
}
const number = wantedNumber ? numbers.find((n) => n.id === wantedNumber) : numbers[0];
if (wantedNumber && !number) {
  throw new Error("VAPI_PHONE_NUMBER_ID was not found.");
}
const assistantId = env("VAPI_ASSISTANT_ID", false) || number?.assistantId;
const existing = assistantId ? await vapi("GET", `/assistant/${assistantId}`) : null;
const existingTools: {
  id: string;
  function?: { name?: string };
  server?: { url?: string };
}[] = await vapi("GET", "/tool?limit=100");
const toolIds: string[] = [];
const template = await load("assistant.json");
const files = [
  "tool-get-call-context.json",
  "tool-create-task.json",
  "tool-get-task-status.json",
  "tool-decide-action.json",
  "tool-cancel-task.json",
  "tool-respond-to-task.json",
  "tool-prepare-action.json",
];
const reads = definitions(new Set(["gmail", "calendar", "contacts", "places", "outlook"]))
  .filter((t) => READ_TOOLS.includes(t.function.name))
  .map((t) => ({
    ...t,
    async: false,
    server: { ...template.server, url: `https://${projectRef}.supabase.co/functions/v1/voice-tools`, timeoutSeconds: 30 },
  }));
const specs = [...await Promise.all(files.map(load)), ...reads];
const managedNames = new Set(specs.map((t) => t.function.name));
for (const tool of specs) {
  const found = existingTools.find((t) => existing?.model?.toolIds?.includes(t.id) && t.function?.name === tool.function.name) ??
    existingTools.find((t) => t.function?.name === tool.function.name && t.server?.url === tool.server.url);
  const { type: _type, ...patch } = tool;
  const saved = found ? await vapi("PATCH", `/tool/${found.id}`, patch) : await vapi("POST", "/tool", tool);
  toolIds.push(saved.id);
  console.log(`tool ${tool.function.name}: ${found ? "updated" : "created"}`);
}
const replacedIds = new Set(existingTools.filter((t) => managedNames.has(t.function?.name)).map((t) => t.id));
const oldModel = existing?.model
  ? { ...existing.model, toolIds: (existing.model.toolIds ?? []).filter((id: string) => !replacedIds.has(id)) }
  : undefined;
const model = configureAssistantModel(
  oldModel,
  template.model,
  toolIds,
  await Deno.readTextFile(new URL("gpt-live-speaker.txt", dir)),
);
const changes = {
  model,
  server: template.server,
  serverMessages: [
    ...new Set([
      ...(existing?.serverMessages ?? []),
      "tool-calls",
      "end-of-call-report",
    ]),
  ],
};
const saved = existing
  ? await vapi("PATCH", `/assistant/${existing.id}`, changes)
  : await vapi("POST", "/assistant", { ...template, ...changes });
console.log(`assistant configured: ${saved.id}`);
const verified = await vapi("GET", `/assistant/${saved.id}`);
if (
  model.model === "gpt-live-1" && (
    verified.model?.speaker?.instructions !== model.speaker.instructions ||
    verified.model?.reasoner?.instructions !== model.reasoner.instructions
  )
) throw new Error("Vapi did not persist the requested GPT-Live instructions. Setup is incomplete.");
if (toolIds.some((id) => !verified.model?.toolIds?.includes(id))) {
  throw new Error("Vapi did not retain every configured Alo tool.");
}
console.log("Verified saved instructions and tool attachments.");
if (number && number.assistantId !== saved.id) {
  await vapi("PATCH", `/phone-number/${number.id}`, { assistantId: saved.id });
}
