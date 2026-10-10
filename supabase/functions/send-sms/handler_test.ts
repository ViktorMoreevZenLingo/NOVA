import { Webhook } from "npm:standardwebhooks@1.0.0";
import { createHandler } from "./handler.ts";

const secret = btoa("01234567890123456789012345678901");
const config = {
  hookSecret: `v1,whsec_${secret}`,
  apiKey: "test-key",
  apiSecret: "test-secret",
};
function assert(value: unknown) {
  if (!value) throw new Error("Assertion failed");
}
function signed(phone = "359879000000", date = new Date()) {
  const body = JSON.stringify({ user: { phone }, sms: { otp: "012345" } });
  return new Request("https://example.com", {
    method: "POST",
    body,
    headers: {
      "webhook-id": "test-id",
      "webhook-timestamp": String(Math.floor(date.getTime() / 1000)),
      "webhook-signature": new Webhook(secret).sign("test-id", date, body),
    },
  });
}
Deno.test("unsigned, expired, and unsupported destinations never send SMS", async () => {
  let calls = 0;
  const handler = createHandler(
    config,
    (() => {
      calls++;
      throw Error();
    }) as typeof fetch,
  );
  assert(
    (await handler(
      new Request("https://example.com", { method: "POST", body: "{}" }),
    )).status === 401,
  );
  assert((await handler(signed("359879000000", new Date(0)))).status === 401);
  assert((await handler(signed("15555550198"))).status === 400);
  assert(calls === 0);
});
Deno.test("signed hook preserves leading-zero OTP and accepts confirmed provider response", async () => {
  const handler = createHandler(
    config,
    (async (input: RequestInfo | URL) => {
      const req = input as Request;
      const body = new URLSearchParams(await req.text());
      assert(body.get("number") === "359879000000");
      assert(body.get("message")?.includes("012345"));
      assert(req.headers.get("Authorization")?.startsWith("test-key:"));
      return Response.json({ status: "success", messages: 1 });
    }) as typeof fetch,
  );
  assert((await handler(signed())).status === 200);
});
Deno.test("provider rejection, denied recipient and malformed success fail closed", async () => {
  for (
    const result of [
      { status: "error", message: "private provider error" },
      { status: "success", messages: 0 },
      { status: "success" },
      { status: "success", messages: 1, denied_numbers: [{}] },
    ]
  ) {
    const handler = createHandler(
      config,
      (async () => Response.json(result)) as typeof fetch,
    );
    const response = await handler(signed());
    assert(response.status === 502);
    assert(!(await response.text()).includes("private provider error"));
  }
});
