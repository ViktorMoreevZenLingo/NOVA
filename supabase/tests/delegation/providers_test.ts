import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.19";
import { runTool } from "../../functions/_shared/delegation/providers.ts";
Deno.test("provider adapters: bounded Gmail, Contacts, Calendar, Places and Outlook requests; tokens stay in Authorization", async () => {
  const original = globalThis.fetch;
  for (
    const [k, v] of Object.entries({
      SUPABASE_URL: "https://database.test",
      SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
      GOOGLE_PLACES_API_KEY: "places-test-key",
      GOOGLE_CLIENT_ID: "test",
      GOOGLE_CLIENT_SECRET: "test",
      MICROSOFT_CLIENT_ID: "test",
      MICROSOFT_CLIENT_SECRET: "test",
    })
  ) Deno.env.set(k, v);
  const requests: { url: string; body: any; auth: string | null }[] = [];
  let expired = false;
  let refreshFails = false;
  let refreshes = 0;
  let htmlOnly = false;
  let emptyInbox = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    if (url.includes("/rest/v1/connections")) {
      return Response.json({ service: "connected" });
    }
    if (url.includes("/rest/v1/provider_tokens")) {
      return Response.json({
        access_token: "private-token",
        expires_at: expired ? "2020-01-01" : "2099-01-01",
        refresh_token: "refresh-test",
        scope: "",
      });
    }
    if (url.includes("oauth2.googleapis.com/token")) {
      refreshes++;
      return refreshFails
        ? Response.json({ error: "invalid_grant" }, { status: 400 })
        : Response.json({ access_token: "private-token", expires_in: 3600 });
    }
    requests.push({
      url,
      body: init?.body ? JSON.parse(String(init.body)) : null,
      auth: headers.get("Authorization"),
    });
    if (url.includes("/messages?") && url.includes("gmail")) {
      return Response.json({ messages: emptyInbox ? [] : [{ id: "message" }] });
    }
    return Response.json({
      id: "receipt",
      payload: {
        headers: [],
        mimeType: htmlOnly ? "text/html" : "text/plain",
        body: {
          data: btoa(
            htmlOnly
              ? "<p>Read &amp; summarize <b>this email</b>.</p><script>secret()</script><img src='https://tracker.test'>"
              : "Test content",
          ),
        },
      },
    });
  }) as typeof fetch;
  try {
    Deno.env.delete("MANUS_API_KEY");
    const latest = await runTool("owner", "get_latest_email", {});
    assertEquals(latest.body, "Test content");
    const inbox = new URL(
      requests.find((r) => r.url.includes("/messages?"))!.url,
    );
    assertEquals(inbox.searchParams.get("q"), "in:inbox");
    assertEquals(inbox.searchParams.get("maxResults"), "1");
    assert(!inbox.href.includes("newer_than"));
    htmlOnly = true;
    const html = await runTool("owner", "get_latest_email", {});
    assertEquals(html.body, "Read & summarize this email.");
    assert(!requests.some((r) => r.url.includes("tracker.test")));
    htmlOnly = false;
    emptyInbox = true;
    assertEquals((await runTool("owner", "get_latest_email", {})).empty, true);
    emptyInbox = false;
    expired = true;
    assertEquals(
      (await runTool("owner", "get_latest_email", {})).body,
      "Test content",
    );
    assertEquals(refreshes, 1);
    refreshFails = true;
    await assertRejects(
      () => runTool("owner", "get_latest_email", {}),
      Error,
      "connect the service again",
    );
    expired = false;
    refreshFails = false;
    await runTool("owner", "search_emails", { query: "subject:test", max: 1 });
    await runTool("owner", "get_email", { id: "message" });
    await runTool("owner", "send_email", {
      to: "self@example.test",
      subject: "Test",
      body: "Body",
    });
    await runTool("owner", "create_email_draft", {
      to: "self@example.test",
      subject: "Test",
      body: "Body",
    });
    await runTool("owner", "search_contacts", { query: "Maria" });
    await runTool("owner", "list_calendar_events", {
      from: "2026-10-25",
      to: "2026-10-25",
    }, "Europe/Sofia");
    const calendar = new URL(requests.at(-1)!.url);
    assertEquals(
      calendar.searchParams.get("timeMin"),
      "2026-10-24T21:00:00.000Z",
    );
    assertEquals(
      calendar.searchParams.get("timeMax"),
      "2026-10-25T22:00:00.000Z",
    );
    await runTool("owner", "create_calendar_event", {
      title: "Test",
      start: "2026-10-26T10:00:00+02:00",
      end: "2026-10-26T10:30:00+02:00",
    });
    await runTool("owner", "search_places", { query: "parks in Sofia" });
    await runTool("owner", "read_outlook_mail", {});
    await runTool("owner", "read_outlook_calendar", {});
    await runTool("owner", "search_outlook_contacts", { query: "O'Neil" });
    assert(
      requests.some((r) => r.url.includes("/drafts") && r.body.message.raw),
    );
    assert(requests.some((r) => r.url.endsWith("/send") && r.body.raw));
    assert(
      requests.every((r) =>
        !r.url.includes("private-token") &&
        !JSON.stringify(r.body).includes("private-token")
      ),
    );
    assert(
      requests.filter((r) => !r.url.includes("places.googleapis.com")).every(
        (r) => r.auth === "Bearer private-token",
      ),
    );
    await assertRejects(() =>
      runTool("owner", "send_email", {
        to: "self@example.test\r\nBcc:bad@example.test",
        subject: "Test",
        body: "Body",
      })
    );
  } finally {
    let expired = false;
    let refreshFails = false;
    let refreshes = 0;
    let htmlOnly = false;
    let emptyInbox = false;
    globalThis.fetch = original;
  }
});
