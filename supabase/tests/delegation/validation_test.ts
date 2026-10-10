import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1.0.19";
import {
  authorized,
  canonical,
  decision,
  validateArgs,
  validateGrant,
  validateSubmission,
} from "../../functions/_shared/delegation/validation.ts";
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
