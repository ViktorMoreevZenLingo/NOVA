import { calendarRange } from "../../functions/_shared/delegation/calendar.ts";
import { definitions } from "../../functions/_shared/tools.ts";
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  authorized,
  canonical,
  decision,
  validateArgs,
  validateGrant,
  validateSubmission,
} from "../../functions/_shared/delegation/validation.ts";
Deno.test("calendar reads: advertised limits match validation, including Manus max 50", () => {
  const tools = definitions(new Set(["calendar", "gmail"]));
  for (const tool of tools) {
    for (
      const [key, schema] of Object.entries(tool.function.parameters.properties)
    ) {
      const limit = schema as { type: string; maximum?: number };
      if (limit.type !== "integer") continue;
      const base = tool.function.name === "search_emails"
        ? { query: "test" }
        : {};
      validateArgs(tool.function.name, { ...base, [key]: limit.maximum });
      assertThrows(() =>
        validateArgs(tool.function.name, { ...base, [key]: limit.maximum! + 1 })
      );
    }
  }
  assertEquals(
    decision({
      kind: "read",
      tool: "list_calendar_events",
      args: '{"from":"2026-10-12","to":"2026-10-18","max":50}',
      text: "Read calendar",
    }).kind,
    "read",
  );
});
Deno.test("submission: one-off schedules require offsets, valid zones, and future times", () => {
  const base = {
    request_id: "1",
    instruction: "Summarize",
    start_mode: "scheduled",
    timezone: "Europe/Sofia",
  };
  const now = Date.parse("2026-10-10T00:00:00Z");
  assertEquals(
    validateSubmission({ ...base, run_at: "2026-10-25T03:30:00+03:00" }, now)
      .run_at,
    "2026-10-25T00:30:00.000Z",
  );
  assertEquals(
    validateSubmission({ ...base, run_at: "2026-10-25T03:30:00+02:00" }, now)
      .run_at,
    "2026-10-25T01:30:00.000Z",
  );
  for (
    const run_at of ["2026-10-25T03:30:00", "yesterday", "2025-01-01T00:00:00Z"]
  ) assertThrows(() => validateSubmission({ ...base, run_at }, now));
  assertThrows(() =>
    validateSubmission({
      ...base,
      run_at: "2026-10-25T03:30:00Z",
      timezone: "No/Such",
    }, now)
  );
  assertThrows(() =>
    validateSubmission({
      request_id: "1",
      instruction: "Test",
      start_mode: "after_call",
    })
  );
});
Deno.test("grants: no wildcard recipients, fixed arguments cannot be expanded", () => {
  const grant = validateGrant({
    tool: "send_email",
    constraints: { to: "maria@example.com" },
    generated_fields: ["subject", "body"],
  });
  assert(
    authorized(grant, "send_email", {
      to: "maria@example.com",
      subject: "Hi",
      body: "Summary",
    }),
  );
  assert(
    !authorized(grant, "send_email", {
      to: "other@example.com",
      subject: "Hi",
      body: "Summary",
    }),
  );
  assert(
    !authorized(grant, "send_email", {
      to: "maria@example.com",
      cc: "other@example.com",
      subject: "Hi",
      body: "Summary",
    }),
  );
  assertThrows(() =>
    validateGrant({
      tool: "send_email",
      constraints: {},
      generated_fields: ["to", "subject", "body"],
    })
  );
  assertThrows(() =>
    validateGrant({
      tool: "create_calendar_event",
      constraints: { title: "Event" },
      generated_fields: ["start", "end"],
    })
  );
  assertEquals(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
});
Deno.test("tools: validate every supported integration and reject arbitrary access", () => {
  const valid: Record<string, unknown> = {
    list_recent_emails: { hours: 24, max: 10 },
    search_emails: { query: "is:unread" },
    get_email: { id: "123" },
    send_email: { to: "a@example.com", subject: "Subject", body: "Body" },
    create_email_draft: { to: "a@example.com", subject: "S", body: "B" },
    list_calendar_events: { from: "2026-10-11", to: "2026-10-11" },
    create_calendar_event: {
      title: "Meeting",
      start: "2026-10-11T12:00:00+03:00",
      end: "2026-10-11T13:00:00+03:00",
    },
    search_contacts: { query: "Maria" },
    search_places: { query: "Sofia cafe" },
    read_outlook_mail: {},
    read_outlook_calendar: {},
    search_outlook_contacts: { query: "Maria" },
  };
  for (const [name, args] of Object.entries(valid)) validateArgs(name, args);
  assertThrows(() => validateArgs("delete_email", {}));
  assertThrows(() => validateArgs("read_outlook_mail", { user_id: "another" }));
  assertThrows(() =>
    validateArgs("send_email", {
      to: "a@example.com\r\nBcc: b@example.com",
      subject: "S",
      body: "B",
    })
  );
  assertThrows(() => validateArgs("list_recent_emails", { max: 100000 }));
  assertThrows(() =>
    decision({
      kind: "read",
      tool: "send_email",
      args: JSON.stringify(valid.send_email),
      text: "",
    })
  );
});

Deno.test("calendar: next week is Monday–Sunday in Sofia, including DST and year boundaries", () => {
  const range = (instruction: string, iso: string, args = {}) =>
    calendarRange(args, instruction, "Europe/Sofia", new Date(iso));
  assertEquals(
    range("следващата седмица", "2026-10-10T12:00:00Z", { days_ahead: 14 }),
    { from: "2026-10-12", to: "2026-10-18", max: 25 },
  );
  assertEquals(range("next week", "2026-10-19T12:00:00Z"), {
    from: "2026-10-26",
    to: "2026-11-01",
    max: 25,
  });
  assertEquals(range("next week", "2026-12-31T12:00:00Z"), {
    from: "2027-01-04",
    to: "2027-01-10",
    max: 25,
  });
  assertEquals(range("днес", "2026-10-10T22:30:00Z"), {
    from: "2026-10-11",
    to: "2026-10-11",
    max: 25,
  });
  assertEquals(
    range("next week", "2026-10-10T12:00:00Z", {
      from: "2026-11-02",
      to: "2026-11-03",
    }),
    { from: "2026-11-02", to: "2026-11-03", max: 25 },
  );
  assertThrows(() =>
    validateSubmission({
      request_id: "bad",
      instruction: "Bad",
      initial_read: {
        tool: "send_email",
        args: { to: "a@example.com", subject: "S", body: "B" },
      },
    })
  );
});
