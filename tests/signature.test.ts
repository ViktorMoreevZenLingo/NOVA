import { assertEquals } from "jsr:@std/assert@1";
import { verifyManusSignature } from "../supabase/functions/_shared/manus.ts";
import { makeSigner } from "./fakes.ts";

const URL = "https://example.supabase.co/functions/v1/manus-webhook";
const BODY = JSON.stringify({ event_id: "e1", event_type: "task_stopped" });

Deno.test("signature: valid signature verifies", async () => {
  const { pem, sign } = await makeSigner();
  const ts = Math.floor(Date.now() / 1000);
  const sig = await sign(URL, BODY, ts);
  assertEquals(await verifyManusSignature({ publicKeyPem: pem, url: URL, rawBody: BODY, signatureB64: sig, timestamp: String(ts) }), true);
});

Deno.test("signature: tampered body, wrong url, wrong key are rejected", async () => {
  const { pem, sign } = await makeSigner();
  const other = await makeSigner();
  const ts = Math.floor(Date.now() / 1000);
  const sig = await sign(URL, BODY, ts);
  const base = { publicKeyPem: pem, url: URL, rawBody: BODY, signatureB64: sig, timestamp: String(ts) };
  assertEquals(await verifyManusSignature({ ...base, rawBody: BODY + " " }), false);
  assertEquals(await verifyManusSignature({ ...base, url: URL + "?x=1" }), false);
  assertEquals(await verifyManusSignature({ ...base, publicKeyPem: other.pem }), false);
  assertEquals(await verifyManusSignature({ ...base, signatureB64: "not-base64!!" }), false);
});

Deno.test("signature: stale or future timestamps are rejected", async () => {
  const { pem, sign } = await makeSigner();
  const now = Math.floor(Date.now() / 1000);
  for (const ts of [now - 301, now + 301]) {
    const sig = await sign(URL, BODY, ts);
    assertEquals(
      await verifyManusSignature({ publicKeyPem: pem, url: URL, rawBody: BODY, signatureB64: sig, timestamp: String(ts), nowSeconds: now }),
      false,
    );
  }
});
