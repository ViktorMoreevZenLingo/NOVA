import { HttpError } from "../http.ts";
import { queryLimit } from "../query-limits.ts";
import type { Args, Decision, Grant } from "./contracts.ts";
export const SERVICES: Record<string, string> = {
  list_recent_emails: "gmail",
  search_emails: "gmail",
  get_email: "gmail",
  get_latest_email: "gmail",
  send_email: "gmail",
  create_email_draft: "gmail",
  list_calendar_events: "calendar",
  create_calendar_event: "calendar",
  search_contacts: "contacts",
  search_places: "places",
  read_outlook_mail: "outlook",
  read_outlook_calendar: "outlook",
  search_outlook_contacts: "outlook",
};
export const WRITES = new Set([
  "send_email",
  "create_calendar_event",
  "create_email_draft",
]);
const keys: Record<string, string[]> = {
  list_recent_emails: ["hours", "max"],
  search_emails: ["query", "max"],
  get_email: ["id"],
  get_latest_email: [],
  send_email: ["to", "cc", "subject", "body"],
  create_email_draft: ["to", "cc", "subject", "body"],
  list_calendar_events: ["from", "to", "days_ahead", "max"],
  create_calendar_event: [
    "title",
    "start",
    "end",
    "description",
    "location",
    "attendees",
  ],
  search_contacts: ["query"],
  search_places: ["query"],
  read_outlook_mail: [],
  read_outlook_calendar: [],
  search_outlook_contacts: ["query"],
};
export function object(value: unknown): Args {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Expected an object.");
  }
  return value as Args;
}
export function text(v: unknown, max = 10000): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) {
    throw new HttpError(400, "Missing or invalid text.");
  }
  return v.trim();
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${
      Object.keys(value).sort().map((k) =>
        `${JSON.stringify(k)}:${canonical((value as Args)[k])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}
const email = /^[^\s<>@,;\r\n]+@[^\s<>@,;\r\n]+\.[^\s<>@,;\r\n]+$/;
export function validateArgs(tool: string, value: unknown): Args {
  if (!Object.hasOwn(SERVICES, tool)) {
    throw new HttpError(400, "Unsupported action.");
  }
  const a = object(value);
  if (Object.keys(a).some((k) => !keys[tool].includes(k))) {
    throw new HttpError(400, "Unexpected tool arguments.");
  }
  for (const [k, v] of Object.entries(a)) {
    if (["max", "hours", "days_ahead"].includes(k)) {
      const cap = queryLimit(tool, k);
      if (!Number.isInteger(v) || Number(v) < 1 || Number(v) > cap) {
        throw new HttpError(400, "Invalid query limit.");
      }
    } else if (k === "attendees") {
      if (
        !Array.isArray(v) || v.length > 20 ||
        v.some((e) => typeof e !== "string" || !email.test(e))
      ) throw new HttpError(400, "Invalid attendees.");
    } else if (
      typeof v !== "string" || v.length > (k === "body" ? 20000 : 2000)
    ) throw new HttpError(400, "Invalid argument.");
  }
  for (
    const k of tool === "send_email" || tool === "create_email_draft"
      ? ["to", "subject", "body"]
      : tool === "create_calendar_event"
      ? ["title", "start", "end"]
      : tool === "get_email"
      ? ["id"]
      : tool.startsWith("search_")
      ? ["query"]
      : []
  ) text(a[k], k === "body" ? 20000 : 2000);
  for (const k of ["to", "cc"]) {
    if (
      (tool === "send_email" || tool === "create_email_draft") && a[k] &&
      !email.test(String(a[k]))
    ) {
      throw new HttpError(
        400,
        "Use one explicit email address per recipient field.",
      );
    }
  }
  for (const k of ["from", "to"]) {
    if (
      tool === "list_calendar_events" && a[k] &&
      !/^\d{4}-\d{2}-\d{2}$/.test(String(a[k]))
    ) throw new HttpError(400, "Use YYYY-MM-DD calendar dates.");
  }
  if (
    tool === "create_calendar_event" &&
    (![a.start, a.end].every((v) =>
      typeof v === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(v) &&
      Number.isFinite(Date.parse(v))
    ) || Date.parse(String(a.end)) <= Date.parse(String(a.start)))
  ) {
    throw new HttpError(
      400,
      "Calendar times require explicit offsets and a positive duration.",
    );
  }
  return a;
}
export function validateGrant(value: unknown): Grant {
  const g = object(value);
  const tool = text(g.tool, 80);
  const constraints = object(g.constraints);
  if (!WRITES.has(tool)) {
    throw new HttpError(400, "Only supported writes need grants.");
  }
  const generated = g.generated_fields ?? [];
  const permitted = tool === "create_calendar_event"
    ? ["title", "description"]
    : ["subject", "body"];
  if (
    !Array.isArray(generated) || generated.some((k) => !permitted.includes(k))
  ) {
    throw new HttpError(
      400,
      "Recipient and event details cannot be generated permissions.",
    );
  }
  if (generated.some((k) => Object.hasOwn(constraints, k))) {
    throw new HttpError(400, "A field cannot be both fixed and generated.");
  }
  validateArgs(tool, {
    ...constraints,
    ...Object.fromEntries(generated.map((k) => [k, "Generated content"])),
  });
  return { tool, constraints, generated_fields: generated };
}
export function authorized(grant: Grant, tool: string, args: Args): boolean {
  return grant.tool === tool &&
    Object.entries(grant.constraints).every(([k, v]) =>
      canonical(args[k]) === canonical(v)
    ) &&
    Object.keys(args).every((k) =>
      Object.hasOwn(grant.constraints, k) || grant.generated_fields.includes(k)
    );
}
export function validateSubmission(input: unknown, now = Date.now()) {
  const d = object(input);
  const start_mode = d.start_mode ?? "now";
  if (!["now", "after_call", "scheduled"].includes(String(start_mode))) {
    throw new HttpError(400, "Invalid start mode.");
  }
  const timezone = d.timezone ?? "Europe/Sofia";
  try {
    new Intl.DateTimeFormat("en", { timeZone: String(timezone) }).format();
  } catch {
    throw new HttpError(400, "Invalid timezone.");
  }
  let run_at: string | null = null;
  if (start_mode === "scheduled") {
    const value = text(d.run_at, 80);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) ||
      !/(Z|[+-]\d\d:\d\d)$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || Date.parse(value) <= now
    ) {
      throw new HttpError(
        400,
        "Choose a future time with an explicit UTC offset.",
      );
    }
    run_at = new Date(value).toISOString();
  } else if (d.run_at) {
    throw new HttpError(400, "Only scheduled tasks accept run_at.");
  }
  const call_id = d.call_id ? text(d.call_id, 160) : null;
  if (start_mode === "after_call" && !call_id) {
    throw new HttpError(400, "After-call tasks require a verified call.");
  }
  const grants = d.grants ?? [], delivery = d.delivery_channels ?? [];
  if (
    !Array.isArray(grants) || grants.length > 10 || !Array.isArray(delivery) ||
    delivery.length > 3 ||
    delivery.some((c) => !["email", "callback", "sms"].includes(c))
  ) throw new HttpError(400, "Invalid permissions or delivery channels.");
  const required = d.required_tools ?? [];
  if (
    !Array.isArray(required) || required.length > 10 ||
    required.some((tool) => typeof tool !== "string" || !WRITES.has(tool))
  ) {
    throw new HttpError(400, "Invalid required actions.");
  }
  let initial_read;
  if (d.initial_read !== undefined) {
    const read = object(d.initial_read);
    const tool = text(read.tool, 80);
    if (WRITES.has(tool)) {
      throw new HttpError(400, "Initial context must be a read.");
    }
    initial_read = { tool, args: validateArgs(tool, read.args) };
  }
  let prepared_action;
  if (d.prepared_action !== undefined) {
    const action = object(d.prepared_action);
    const tool = text(action.tool, 80);
    if (!["send_email", "create_calendar_event"].includes(tool)) {
      throw new HttpError(400, "Unsupported prepared action.");
    }
    prepared_action = { tool, args: validateArgs(tool, action.args) };
  }
  let delegation;
  if (d.delegation !== undefined) {
    const supplied = object(d.delegation);
    if (supplied.requested !== true) throw new HttpError(400, "Explicit delegation is required.");
    delegation = { requested: true, request: text(supplied.request, 4000) };
  }
  return {
    ...(delegation ? { delegation } : {}),
    ...(prepared_action ? { prepared_action } : {}),
    ...(initial_read ? { initial_read } : {}),
    ...(required.length ? { required_tools: required } : {}),
    request_id: text(d.request_id, 160),
    instruction: text(d.instruction),
    start_mode,
    run_at,
    timezone: String(timezone),
    call_id,
    call_activity_id: d.call_activity_id ? text(d.call_activity_id, 36) : null,
    grants: grants.map(validateGrant),
    delivery_channels: [...new Set(delivery)],
  };
}
export function decision(value: unknown): Decision {
  const d = object(value);
  if (
    !["read", "action", "done", "question"].includes(String(d.kind)) ||
    typeof d.tool !== "string" || typeof d.args !== "string" ||
    typeof d.text !== "string" || d.text.length > 40000
  ) throw new HttpError(400, "Invalid Manus result.");
  if (d.kind === "read" || d.kind === "action") {
    validateArgs(d.tool, JSON.parse(d.args));
    if (WRITES.has(d.tool) !== (d.kind === "action")) {
      throw new HttpError(400, "Wrong action type.");
    }
  } else text(d.text, 40000);
  return d as unknown as Decision;
}
