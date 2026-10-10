import { assertEquals } from "jsr:@std/assert@1.0.19";
import { webhookHandler } from "../../functions/task-webhook/handler.ts";
import { makeSigner } from "./signer.ts";
Deno.test("webhook: signed events are deduplicated; unsigned probes and invalid signatures cannot mutate tasks", async () => {
  const signer = await makeSigner();
  const url = "https://example.test/task-webhook";
  const seen = new Set<string>();
  let wakes = 0;
  const db = {
    from: (table: string) => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: { id: "task" }, error: null }),
        insert: async (v: { event_id: string }) => {
          if (seen.has(v.event_id)) return { error: { code: "23505" } };
          seen.add(v.event_id);
          return { error: null };
        },
        update: () => {
          wakes++;
          return b;
        },
        then: (r: (v: unknown) => void) => r({ error: null }),
      };
      return b;
    },
  };
  const handler = webhookHandler(
    { publicKeyPem: async () => signer.pem } as never,
    url,
    db as never,
  );
  const raw = JSON.stringify({
    event_id: "event",
    task_detail: { task_id: "manus" },
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signer.sign(url, raw, timestamp);
  const request = (sig?: string) =>
    new Request(url, {
      method: "POST",
      body: raw,
      headers: sig
        ? {
          "x-webhook-signature": sig,
          "x-webhook-timestamp": String(timestamp),
        }
        : {},
    });
  assertEquals((await handler(request())).status, 200);
  assertEquals(seen.size, 0);
  assertEquals(wakes, 0);
  assertEquals((await handler(request("invalid"))).status, 401);
  assertEquals(wakes, 0);
  assertEquals((await handler(request(signature))).status, 200);
  assertEquals((await handler(request(signature))).status, 200);
  assertEquals(seen.size, 1);
  // Duplicate wakeups are harmless; neither handler executes a task or a provider action.
  assertEquals(wakes, 2);
});
