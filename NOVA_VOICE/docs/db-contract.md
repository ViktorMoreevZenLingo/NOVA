# Shared database contract (Alo app ↔ phone assistant)

There's one Supabase project (`vlimtocbrxxnzobhkcoy`) and one migration history (`supabase/migrations`, applied by `supabase db push` in CI). Every schema change is a new migration file in `supabase/migrations`. Don't edit migrations that are already applied, and don't change schema from the dashboard without adding a migration.

## Who owns what

| Table / function | Owner | Browser (signed-in user) | Written by |
|---|---|---|---|
| `profiles` (id, name, notes, photo) | Alo | read/insert/update own | the app |
| `connections` (user_id, service) | Alo | read own | `integrations` function |
| `activity` (call/callback/task/sms history) | Alo | read own | `agent` function, **and the `agent_tasks` mirror trigger** |
| `provider_tokens`, `oauth_states`, `agent_state` | Alo | none | Alo functions |
| `agent_tasks` (phone tasks, Manus state) | phone assistant | read own | phone-assistant functions (service role) |
| `call_sessions` (PIN attempts per call) | phone assistant | none | phone-assistant functions |
| `nova_user_id_by_phone(phone)` | phone assistant | no execute | caller lookup on confirmed `auth.users.phone` |
| `claim_notification` / `mark_notified` / `release_notification` / `mark_submit_failed` / `claim_reconcile_batch` / `record_pin_failure` / `recent_pin_failures` / `nova_set_vault_secret` | phone assistant | no execute | service role / CI |

## How phone tasks reach the app

- **History:** every row in `agent_tasks` is mirrored into `activity` by the `agent_tasks_sync_activity` trigger:
  - `activity.id` is the same as `agent_tasks.id`
  - `type = 'task'`
  - `title = { en: "Email summary: …" | "Research: …", bg: … }`
  - `detail` holds the result, or the failure reason
  - `status` is `in_progress` → `done` (or `needs_input`)
  - The app needs no changes. For live updates, `activity` would also have to be added to the `supabase_realtime` publication.
- **Profile context:** the caller's `profiles.name` and `notes` (first 1,500 characters) are sent to Manus as context only, never as instructions.
- **Gmail:** a "summarize my emails" call reads the caller's own inbox through their `connections`/`provider_tokens` (Alo's `_shared/tools.ts`). The result email goes from that Gmail to the same address. Without a Gmail connection, the task fails right away with a clear message.
- **Account deletion:** cascades to `agent_tasks` and `call_sessions`.

## For the frontend
- Phone tasks are already in `activity`, so no extra query is needed.
- To link to Manus, read `agent_tasks.manus_task_url` by the same id:
  `supabase.from("agent_tasks").select("manus_task_url").eq("id", activity.id).maybeSingle()`.
