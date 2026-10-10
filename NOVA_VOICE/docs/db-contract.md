# Shared database contract (Alo app ↔ phone assistant)

There's one Supabase project (`vlimtocbrxxnzobhkcoy`) and one migration history (`supabase/migrations`, applied by `supabase db push` in CI). Every schema change is a new migration file in `supabase/migrations`. Don't edit migrations that are already applied, and don't change schema from the dashboard without adding a migration.

## Current delegated runtime

New requests use `alo_tasks`, leased `alo_task_steps`, deduplicated `alo_task_events`, and separate `alo_task_deliveries`. The authoritative API and ownership contract is [ManusIntegration](../../docs/ManusIntegration.md). Legacy security-level/PIN fields below are retained for old tasks; new telephone requests use the owner-requested phone matching policy, with exact-action approval for writes.

Migration `20261010122000_task_initial_context.sql` additively replaces `alo_task_submit` to persist optional validated `state.initial_read = {tool, args}`. It does not change browser grants or expose provider tokens. The worker checks the connection and journals the result as the task's `initial-context` read step before sending bounded data to Manus. `prepared_action` continues to require exact approval and bypasses Manus only for fully specified supported writes.

## Who owns what

| Table / function | Owner | Browser (signed-in user) | Written by |
|---|---|---|---|
| `profiles` (id, name, notes, photo) | Alo | read/insert/update own | the app |
| `connections` (user_id, service) | Alo | read own | `integrations` function |
| `activity` (call/callback/task/sms history) | Alo | read own | `agent` function, **and the `agent_tasks` mirror trigger** |
| `provider_tokens`, `oauth_states`, `agent_state` | Alo | none | Alo functions |
| `agent_tasks` (phone tasks, Manus state) | phone assistant | read own | phone-assistant functions (service role) |
| `call_sessions` (PIN / question attempts, the action read back per call) | phone assistant | none | phone-assistant functions |
| `voice_settings` (user_id, security_level `standard`/`secure`, verification_question, verification_answer_hash) | phone assistant | read own (never the hash); insert/update `security_level`; question via `nova_set_my_verification` | the app |
| `nova_user_id_by_phone(phone)` | phone assistant | no execute | caller lookup: confirmed `auth.users.phone`, or (prototype) `user_metadata.contact_phone`; verified wins |
| `nova_set_my_verification(question, answer)` | phone assistant | **execute** (own account) | stores the answer as bcrypt |
| `claim_notification` / `mark_notified` / `release_notification` / `mark_submit_failed` / `claim_reconcile_batch` / `record_pin_failure` / `recent_pin_failures` / `nova_set_vault_secret` | phone assistant | no execute | service role / CI |

## How phone tasks reach the app

- **History:** every row in `agent_tasks` is mirrored into `activity` by the `agent_tasks_sync_activity` trigger:
  - `activity.id` is the same as `agent_tasks.id`
  - `type = 'task'`
  - `title = { en: "Email summary: …" | "Research: …", bg: … }`
  - `detail` holds the result, or the failure reason
  - `status` is `in_progress` → `done` (or `needs_input`, which also covers "waiting for your approval"; while an approved action is being sent it shows `in_progress`)
  - The app needs no changes. For live updates, `activity` would also have to be added to the `supabase_realtime` publication.
- **Profile context:** the caller's `profiles.name` and `notes` (first 1,500 characters) are sent to Manus as context only, never as instructions.
- **Gmail:** a "summarize my emails" call reads the caller's own inbox through their `connections`/`provider_tokens` (Alo's `_shared/tools.ts`). The result email goes from that Gmail to the same address. Without a Gmail connection, the task fails right away with a clear message.
- **Account deletion:** cascades to `agent_tasks` and `call_sessions`.

## For the frontend
- Phone tasks are already in `activity`, so no extra query is needed.
- To link to Manus, read `agent_tasks.manus_task_url` by the same id:
  `supabase.from("agent_tasks").select("manus_task_url").eq("id", activity.id).maybeSingle()`.

### Approve / reject a phone action (layer L4)
A History item can be waiting for approval: a reply draft, an email or an event requested by phone. The user can approve it **by voice**: they call Alo and say "approve my pending email", and Alo asks for the PIN and the verification question, then reads it back. That works without internet. The app is the alternative when online, and whichever comes first wins.

**How to recognise one:** `activity.status = 'needs_input'` **and** `agent_tasks.status = 'awaiting_approval'` for the same id. The draft is shown in `activity.detail`. The structured fields are in `agent_tasks.params`:
- `{ to, subject, body }` for emails and replies
- `{ title, start, end, attendees }` for events

```ts
const { data: task } = await supabase.from("agent_tasks")
  .select("intent, status, params, risk_level").eq("id", activity.id).maybeSingle();
// task.status === "awaiting_approval" → show Approve / Reject (+ editable body for emails)

const { data, error } = await supabase.functions.invoke("voice-approve", {
  body: { taskId: activity.id, approved: true, body: editedText /* optional, emails only */ },
});
// 200 { status: "completed" | "rejected" } · 409 no longer waiting · 404 not yours · 502 provider failed (don't auto-retry)
```

### Voice security level
```ts
await supabase.from("voice_settings").upsert({ user_id: user.id, security_level: "secure" }); // or "standard"
```

### Verification question (layer L3)
Show `voice_settings.verification_question`. The answer itself is never readable. To set or change both:
```ts
await supabase.rpc("nova_set_my_verification", { p_question: "First pet's name?", p_answer: "Rex" });
```
`standard` (default): PIN on every call; the question only for sending/changing things. `secure`: the question on every call. See the layer table in the [README](../README.md#security-levels-and-access-layers).


## Current delegated task queue

New voice requests use `alo_tasks`, not `agent_tasks`. The adapter preserves caller authentication, then resolves ownership from the verified `call_sessions` row. `alo_task_submit`, `alo_call_ended`, lease/step RPCs and `alo_task_command` are service-only. Browser operations use the `tasks` Edge Function with a verified Supabase session.

- `alo_tasks`: start condition, UTC schedule + original timezone, grants, bounded execution state, result, cancellation and lease. Browser SELECT is owner-scoped.
- `alo_task_steps` / `alo_task_events`: durable execution receipts and webhook dedupe; service-only.
- `alo_task_deliveries`: per-task/channel unique delivery state and leases; owner-scoped browser SELECT. Failed delivery never reruns execution.
- `call_sessions.ended_at`: idempotent after-call release.
- `call_sessions.review_alo_task_id` / `review_alo_revision`: exact-action voice approval, separate from the legacy review pointer.
- `alo_tasks` mirror into `activity` with the same ID, accurate status, and `detail.engine = "manus"`; this marker enables the new History controls.
- Account deletion cascades task/step/event/delivery rows. Call links require the same account.

All result/clarification/approval/cancellation stays in Alo. The frontend does not send users to Manus. See [the full API and rollout contract](../../docs/ManusIntegration.md).
