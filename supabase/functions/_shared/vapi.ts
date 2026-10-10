import { hasBearer } from "./crypto.ts";
import { errorText, log } from "./log.ts";

// Vapi "tool-calls" server message parsing and response formatting.
// Docs: https://docs.vapi.ai/tools/custom-tools

export type VapiToolCall = { id: string; name: string; args: Record<string, unknown> };

export type VapiToolRequest = {
  callId: string;
  callType: string | null;
  /** Metadata we attached when placing an outbound call (private API key only). */
  callMetadata: Record<string, unknown>;
  customerNumber: string | null;
  toolCalls: VapiToolCall[];
};

export type VapiToolResult = { toolCallId: string; result: string } | { toolCallId: string; error: string };

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
}

// deno-lint-ignore no-explicit-any
export function parseToolRequest(body: any): VapiToolRequest | null {
  const message = body?.message;
  if (message?.type !== "tool-calls" || !Array.isArray(message.toolCallList)) return null;
  const callId = message.call?.id;
  if (typeof callId !== "string" || !callId) return null;

  const customerNumber = message.call?.customer?.number ?? message.customer?.number ?? null;
  const toolCalls: VapiToolCall[] = message.toolCallList
    // deno-lint-ignore no-explicit-any
    .filter((tc: any) => typeof tc?.id === "string" && typeof tc?.function?.name === "string")
    // deno-lint-ignore no-explicit-any
    .map((tc: any) => ({ id: tc.id, name: tc.function.name, args: parseArgs(tc.function.arguments) }));

  const metadata = message.call?.metadata;
  return {
    callId,
    callType: message.call?.type ?? null,
    customerNumber,
    toolCalls,
    callMetadata: metadata && typeof metadata === "object" ? metadata : {},
  };
}

/** Vapi requires HTTP 200 even for failures; errors go in the per-call `error` field. */
export function toolResponse(results: VapiToolResult[]): Response {
  return Response.json({ results });
}

export function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const v = args[name];
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number") return String(v);
  return undefined;
}

export type ToolHandler = (call: VapiToolCall, req: VapiToolRequest) => Promise<VapiToolResult>;

/**
 * Wraps tool handlers into a Vapi server endpoint: checks the bearer secret
 * (Vapi credential), parses tool-calls and always answers HTTP 200 with results.
 */
export function vapiToolEndpoint(
  secret: string,
  handlers: Record<string, ToolHandler>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!(await hasBearer(req, secret))) return new Response("Unauthorized", { status: 401 });

    const parsed = parseToolRequest(await req.json().catch(() => null));
    if (!parsed) return new Response("Bad request", { status: 400 });

    const results: VapiToolResult[] = [];
    for (const call of parsed.toolCalls) {
      const handler = handlers[call.name];
      if (!handler) {
        results.push({ toolCallId: call.id, error: `Unsupported tool ${call.name}` });
        continue;
      }
      try {
        results.push(await handler(call, parsed));
      } catch (err) {
        log.error("vapi_tool.error", { tool: call.name, toolCallId: call.id, error: errorText(err) });
        results.push({ toolCallId: call.id, error: "Internal error. Apologize and ask the caller to try again later." });
      }
    }
    return toolResponse(results);
  };
}
