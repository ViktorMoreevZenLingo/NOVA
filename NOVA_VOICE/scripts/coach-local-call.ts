// LOCAL STACK ONLY. Signs in as a demo account and calls the `coach` function, e.g. to place a
// real phone call during a demo:
//   SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
//   deno run --allow-env --allow-net=127.0.0.1 NOVA_VOICE/scripts/coach-local-call.ts +3598XXXXXXXX followup_now
//   ... +3598XXXXXXXX call_me pulse      (the open pulse check-in)
//   ... +3598XXXXXXXX call_me coach      (a fresh coach session)
// It sets a throwaway email/password on the local account to obtain a session (never run it
// against a hosted project).
const api = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
if (!["127.0.0.1", "localhost"].includes(new URL(api).hostname)) throw new Error("Local stack only.");
const anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const [phone, action = "followup_now", mode = "coach"] = Deno.args;
if (!phone) throw new Error("Usage: coach-local-call.ts <phone> [followup_now|call_me] [coach|pulse]");
const h = { apikey: service, Authorization: `Bearer ${service}`, "content-type": "application/json" };
const id =
  await (await fetch(`${api}/rest/v1/rpc/nova_user_id_by_phone`, { method: "POST", headers: h, body: JSON.stringify({ p_phone: phone }) }))
    .json();
if (typeof id !== "string") throw new Error(`No local account for ${phone}`);
const email = `demo-${phone.slice(1)}@example.invalid`, password = crypto.randomUUID();
await fetch(`${api}/auth/v1/admin/users/${id}`, {
  method: "PUT",
  headers: h,
  body: JSON.stringify({ email, email_confirm: true, password }),
});
const session = await (await fetch(`${api}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anon, "content-type": "application/json" },
  body: JSON.stringify({ email, password }),
})).json();
const res = await fetch(`${api}/functions/v1/coach`, {
  method: "POST",
  headers: { apikey: anon, Authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
  body: JSON.stringify({ action, mode }),
});
console.log(res.status, await res.text());
