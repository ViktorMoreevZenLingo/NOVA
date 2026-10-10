/** Wake after committing, without delaying acceptance. Cron remains the recovery path. */
export function wakeTaskWorker() {
  const runtime = (globalThis as unknown as {
    EdgeRuntime?: { waitUntil(p: Promise<unknown>): void };
  }).EdgeRuntime;
  const secret = Deno.env.get("TASK_WORKER_SECRET"),
    url = Deno.env.get("SUPABASE_URL");
  if (!runtime || !secret || !url) return;
  runtime.waitUntil(
    fetch(`${url}/functions/v1/task-worker`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: "{}",
      signal: AbortSignal.timeout(25000),
    }).then((response) => response.body?.cancel()).catch(() => {}),
  );
}
