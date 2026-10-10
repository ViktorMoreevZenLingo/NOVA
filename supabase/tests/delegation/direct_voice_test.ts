import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import {
  compactRead,
  createDirectVoice,
  READ_TOOLS,
} from "../../functions/_shared/delegation/direct-voice.ts";
import { voiceDelegationHandler } from "../../functions/_shared/delegation/voice.ts";
import { HttpError } from "../../functions/_shared/http.ts";
import {
  FakeStore,
  USER_ID,
  USER_PHONE,
  VAPI_SECRET,
} from "../../../NOVA_VOICE/tests/fakes.ts";

Deno.test("direct voice: 20 authenticated call scenarios, bounded reads, no tasks/Manus, spoofing rejected", async () => {
  Deno.env.delete("MANUS_API_KEY");
  let reads = 0;
  const provider = async (
    user: string,
    name: string,
    _args: Record<string, unknown>,
  ) => {
    assertEquals(user, USER_ID);
    reads++;
    if (name === "get_latest_email") {
      return {
        id: "email",
        headers: [{ name: "Subject", value: "Hello" }],
        body: "Read me aloud",
        secret: "must not escape",
      };
    }
    if (name === "search_contacts") {
      return {
        results: [{
          person: {
            names: [{ displayName: "Maria" }],
            emailAddresses: [{ value: "maria1@example.test" }],
          },
        }, {
          person: {
            names: [{ displayName: "Maria" }],
            emailAddresses: [{ value: "maria2@example.test" }],
          },
        }],
      };
    }
    if (name === "list_calendar_events") {
      return {
        items: [{
          summary: "Appointment",
          start: { dateTime: "2026-10-12T10:00:00+03:00" },
        }],
      };
    }
    return [];
  };
  const db = {
    from: () => {
      throw new Error("Reads must not persist a task");
    },
    rpc: () => {
      throw new Error("Reads must not call task RPCs");
    },
  };
  const direct = createDirectVoice(db as never, provider);
  const handler = voiceDelegationHandler({
    vapiSecret: VAPI_SECRET,
    taskSecret: "test",
    caller: { mode: "phone" },
    store: new FakeStore(),
    direct,
    legacy: () => {
      throw new Error("No legacy/Manus route");
    },
  }, db as never);
  const request = (
    name: string,
    args = {},
    phone = USER_PHONE,
    callType = "inboundPhoneCall",
    id = crypto.randomUUID(),
  ) =>
    new Request("https://test/voice-tools", {
      method: "POST",
      headers: { "x-vapi-secret": VAPI_SECRET },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id, type: callType, customer: { number: phone } },
          toolCallList: [{ id: "tool", function: { name, arguments: args } }],
        },
      }),
    });
  for (let i = 0; i < 20; i++) {
    const name = i % 2 ? "search_contacts" : "get_latest_email";
    const response =
      await (await handler(request(name, i % 2 ? { query: "Maria" } : {})))
        .json();
    assertEquals(response.results[0].toolCallId, "tool");
    const result = JSON.parse(response.results[0].result);
    assertEquals(result.status, "ok");
    assert(result.retrieved_at);
    assert(!JSON.stringify(result).includes("must not escape"));
    if (i % 2) assertEquals(result.data.length, 2); // Never silently choose between names.
    else assertEquals(result.data.body, "Read me aloud");
  }
  assertEquals(reads, 20);
  for (
    const req of [
      request("get_latest_email", { user_id: "victim" }),
      request("get_latest_email", {}, "+359899999999"),
      request("get_latest_email", {}, USER_PHONE, "webCall"),
    ]
  ) {
    assert((await (await handler(req)).json()).results[0].error);
  }
  assertEquals(reads, 20);
  const denied = await (await handler(
    request("create_task", {
      intent: "research",
      instruction: "Read my email",
    }),
  )).json();
  assert(denied.results[0].error.includes("explicit"));
  await assertRejects(() => direct.read(USER_ID, "send_email", {}, "call"));
  assertEquals(READ_TOOLS.length, 10);
  const bounded = compactRead("get_email", {
    body: "x".repeat(30000),
    headers: [],
  });
  assertEquals(bounded.truncated, true);
  assert(JSON.stringify(bounded).length < 14000);
  const disconnected = createDirectVoice(db as never, async () => {
    throw new HttpError(409, "Connect gmail in Alo to continue.");
  });
  await assertRejects(
    () => disconnected.read(USER_ID, "get_latest_email", {}, "call"),
    HttpError,
    "Connect gmail",
  );
});

Deno.test("email date readback: Sofia midnight rollover is resolved by backend", () => {
  const result = compactRead("get_email", {
    headers: [{ name: "Date", value: "Fri, 9 Oct 2026 21:06:10 +0000 (GMT)" }],
    body: "Test",
  }).data as Record<string, unknown>;
  assertEquals(result.date_local, "2026-10-10");
  assertEquals(result.time_local, "00:06");
});

Deno.test("calendar notes reach voice context, including HTML lecturers and bounded Outlook notes", () => {
  const result = compactRead("list_calendar_events", {
    items: [{
      id: "lecture",
      summary: "Институционален мениджмънт",
      description:
        "<p>Лектор: <b>проф. Иванова</b></p><p>Тема: местна власт</p><img src='https://example.test/tracker'><script>hidden()</script>",
      organizer: { displayName: "Университет", email: "office@example.test" },
      attendees: [{ displayName: "Студент", email: "student@example.test" }],
      privateToken: "never expose",
    }],
  });
  const event = (result.data as any[])[0];
  assert(event.description.includes("Лектор: проф. Иванова"));
  assert(event.description.includes("Тема: местна власт"));
  assertEquals(event.description_truncated, false);
  assertEquals(result.truncated, false);
  assertEquals(event.organizer.name, "Университет");
  assertEquals(event.attendees[0].name, "Студент");
  assert(!JSON.stringify(result).includes("hidden()"));
  assert(!JSON.stringify(result).includes("tracker"));
  assert(!JSON.stringify(result).includes("never expose"));
  const outlook = compactRead("read_outlook_calendar", {
    value: [{
      id: "outlook-event",
      subject: "Lecture",
      body: { content: "<p>Lecturer: Maria</p>" + "x".repeat(5000) },
    }],
  });
  const other = (outlook.data as any[])[0];
  assert(other.description.startsWith("Lecturer: Maria"));
  assertEquals(other.description.length, 4000);
  assertEquals(other.description_truncated, true);
  assertEquals(outlook.truncated, true);
});
