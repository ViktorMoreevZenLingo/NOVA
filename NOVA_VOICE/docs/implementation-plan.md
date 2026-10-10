# NOVA — Always-On Voice Assistant MVP (Vapi → Supabase → Manus → email)

## Context
Hackathon MVP with two developers. The user phones a Vapi number and asks for an email triage, then hangs up. A Manus task keeps working in the cloud; a webhook brings the result back; Supabase records it; the result is emailed. The demo is about the agent continuing after the call ends.

**Team split (agreed):**
- **Track A, me (this session), branch `feat/vapi-manus`:** the Vapi assistant and tools, the Supabase Edge Functions, the Manus API v2 client, task creation, the webhook, statuses and the `agent_tasks` table.
- **Track B, teammate, branch `feat/gmail-integration`:** connecting Gmail to Manus (`connector.list`), checking that Manus can read and send email, `buildGmailPrompt`, `sendResultEmail`, prompt experiments, and integration tests for email.

- **Track C, third person, built in Lovable:** the user portal. Users sign up and log in, see their task history, and see the Gmail connection status. Gmail is the first integration; Google Calendar, Slack and Home Assistant come later. The portal connects to the **same Supabase project** through Lovable's Supabase integration (not a separate Lovable Cloud backend). It lives in its own GitHub repo, `NOVA-portal`, because Lovable syncs the whole repo it's connected to.
- **Still open:** whether multi-user goes as far as Gmail. The Manus Gmail connector is tied to one Manus account, so either Gmail is shared through the demo account or each user does Google OAuth directly. The schema below supports both, and the decision only changes how Track B fills in `user_integrations`.

Repo: `/Users/olegzaim/Developer/NOVA`. It's an empty clone (`.gitattributes` only, remote `ViktorMoreevZenLingo/NOVA`, `main`). `supabase` and `deno` CLIs aren't installed (`brew install supabase/tap/supabase deno`).

## Verified API facts (docs checked Oct 2026)
**Manus v2** (`https://api.manus.ai/v2/*`, header `x-manus-api-key`)
- `task.create` takes `{ message:{content, connectors:[uuid]}, interactive_mode(false), agent_profile, title, hide_in_task_list, structured_output_schema }` and returns `{task_id, task_url}`. It runs asynchronously.
- The Gmail connector is supported (UUID `9444d960-ab7e-450f-9cb9-b9467fb0adda`, also returned by `connector.list`). It has to be authorized once through OAuth in the Manus web app, and it's tied to that one Manus account. That's fine for a single test user but doesn't extend to many users.
- `task.detail` and `task.listMessages` return the status (`running|waiting|stopped|error`), `has_running_background_jobs` and the `assistant_message` events.
- Webhooks are per account: `webhook.create {url}` or the Developer settings page. They send a test POST that needs a 200 within 10s. The events are `task_created` and `task_stopped` (with `stop_reason: finish|ask`, `task_detail.message`, `attachments`, `structured_output`).
- Signature: `X-Webhook-Signature` is a base64 RSA-SHA256 (PKCS1 v1.5) signature over `{X-Webhook-Timestamp}.{url}.{sha256_hex(rawBody)}`. Requests older than 300s get rejected. The PEM key comes from `GET webhook.publicKey`, cached for about 1h. Deno WebCrypto can verify this without extra dependencies.
  - `{url}` is the registered public URL. It comes from the `MANUS_WEBHOOK_URL` secret, not `req.url`.
- Retry and delivery guarantees are **undocumented**, so there's a reconcile sweep.
- ⚠️ **Note for Track B:** Gmail *send* actions pause the task in `waiting` until someone calls `task.confirmAction`. After the user hangs up nobody confirms, so the task hangs. The notification should go out from the backend (Resend recommended), not from Manus' Gmail send. Track B's "verify sending" check should confirm this.

**Vapi:** the Function tool's `server.url` receives `{message:{type:"tool-calls", toolCallList:[{id,function:{name,arguments}}], call:{id, customer:{number}}}}`. The response is always HTTP 200 `{results:[{toolCallId, result:"<string>"} | {toolCallId, error}]}`. Auth uses a Vapi Bearer credential (`server.credentialId`), so Vapi sends `Authorization: Bearer <VAPI_TOOL_SECRET>`.

**Supabase:** set `verify_jwt = false` per function in `config.toml`, because these functions authenticate their own callers. Secrets go in with `supabase secrets set`.

## Shared contract — agree on this in Stage 0, before splitting
File: `supabase/functions/_shared/contracts.ts`. It's owned jointly and changed only by agreement.
```ts
export type TaskIntent = "summarize_emails" | "research";   // "research" = Track A's Gmail-free demo
export type AgentTaskRequest = { intent: TaskIntent; instruction: string; notifyEmail: string };
export type ManusTaskInput = { content: string; connectors: string[] };
export type TaskResult = { taskId: string; status: "completed" | "needs_input" | "failed"; summary: string; taskUrl?: string };

// Track B implements (in _shared/email/):
export type BuildGmailPrompt = (instruction: string) => Promise<ManusTaskInput>;
export type SendResultEmail  = (recipient: string, result: TaskResult) => Promise<void>; // throws on failure
```
Two deliberate changes from the proposed contract:
1. `buildGmailPrompt` returns `Promise<{content, connectors}>` instead of a `string`. Track B then owns the connector ID too. If the Gmail connector fails and the team falls back to the direct Gmail API, Track B returns `connectors: []` with the email data inlined, and Track A's code doesn't change.
2. `notifyEmail` is **always set by the backend** (`TEST_USER_EMAIL` secret) and never comes from the LLM. The Vapi tool doesn't have a recipient argument.

Idempotency stays with Track A, so `sendResultEmail` can stay a simple "send one email" function. Track A claims the notification row before calling it and releases the claim if it throws.

**File ownership** (prevents merge conflicts):
- Track B: `_shared/email/**` and `tests/email/**`
- Track A: everything else

Until Track B merges, Track A ships **stubs** in `_shared/email/`. `buildGmailPrompt` returns a generic prompt plus the connector from the `MANUS_GMAIL_CONNECTOR_ID` env (if set). `sendResultEmail` logs a redacted line and records `[MOCK]`. Track B replaces those two files.

## Track A architecture
```
Vapi call ─tool-calls─▶ create-task ─▶ agent_tasks (insert) ─▶ Manus task.create
Manus ─task_stopped─▶ manus-webhook ─verify sig─▶ transition row ─▶ sendResultEmail (Track B)
pg_cron 5m ─▶ reconcile: task.detail for stale rows, retry submits/notifications
Vapi (optional) ─▶ get-task-status
```

### Caller auth (caller ID alone isn't trusted)
Three checks:
- Vapi bearer secret, compared in constant time
- caller lookup: `call.customer.number` → `profiles.phone_e164`, which gives the `user_id`
- a 6-digit **spoken PIN** passed as the tool argument `pin`. The MVP checks it against the `TEST_USER_PIN` secret; later it moves to a hashed per-profile PIN. After 3 failures on a `call.id`, that call is locked out. The PIN is never stored or logged.

Phone and PIN setup are **not** in the portal MVP. The demo user's phone number is seeded into `profiles` with SQL.

### Shared DB schema = the contract with Track C (Lovable)
Track A owns every migration in `NOVA/supabase/migrations`. Lovable must **not** generate migrations for these tables. Track C reads them through the Supabase JS client with the user's own JWT, and RLS limits what that user sees.
- **`profiles`**
  - Columns: `user_id uuid pk → auth.users`, `display_name`, `notify_email`, `phone_e164 unique`, `created_at`.
  - Created by a trigger on `auth.users` insert.
  - RLS: the user can select and update their own row. `phone_e164` is admin-only for now, enforced with a column-level grant.
- **`user_integrations`**
  - Columns: `id`, `user_id`, `provider text check in ('gmail','google_calendar','slack','home_assistant')`, `status text check in ('not_connected','pending','connected','error')`, `manus_connector_id text null`, `metadata jsonb`, `updated_at`, unique (`user_id`, `provider`).
  - RLS: users can select their own rows. Writes are service-role only, because they're done by backend or Track B code.
  - It's generic so that Calendar, Slack and Home Assistant are just new `provider` values.
- **`agent_tasks`** gets a `user_id` FK. RLS lets the user **select** their own rows and nothing else. A `user_task_view` can hide internal columns like `error_message` and the attempt counters.
- Optional Edge Function for "Connect Gmail" if the team chooses per-user Google OAuth. That's Track B's decision once multi-user is settled. Until then the portal shows the status and a "contact admin / demo account" note.

`notifyEmail` = `profiles.notify_email` of the authenticated caller. It never comes from the LLM. For the MVP it's seeded to the test address. Resend without a verified domain can only send to the account owner, so that rule holds as long as the demo stays single-recipient.

### `agent_tasks` (migration `0001_init.sql`, together with profiles/user_integrations)
- **Columns:** the fields from the brief, plus `user_id`, `intent`, `manus_task_url`, `notify_attempts int default 0`, `submit_attempts int default 0` and `last_event_at`.
- **Constraints:** unique `manus_task_id`, and a CHECK on status: `pending → submitted → completed | needs_input | failed`, plus a retryable `submit_failed`.
- **Access:** RLS on; users may only SELECT their own rows (portal). All writes go through the service role. An `updated_at` trigger keeps that column current.
- **Transitions** are conditional `UPDATE … WHERE status IN (…) RETURNING`, so duplicate webhooks do nothing.
- **Notification claim:** `SET notified_at=now() WHERE notified_at IS NULL AND status IN ('completed','needs_input','failed')`. If the send throws, `notified_at` goes back to null and `notify_attempts` increments. The sweep retries up to 5 times.

### Lifecycle edge cases
| Situation | What happens |
|---|---|
| `finish` and no background jobs | `completed`; summary = the task_stopped message, or the last `assistant_message` if that's empty |
| `finish` and `has_running_background_jobs` | stays `submitted`; the sweep re-checks |
| `ask` | `needs_input`; the email includes the question + `task_url` (no voice continuation in MVP) |
| `task.create` error/timeout | `submit_failed`; the caller hears "couldn't start, will retry"; the sweep retries ×3, then `failed` + email |
| No webhook ever | the sweep runs `task.detail` on `submitted` rows older than 3 min and goes through the same `completeTask` path |
| Unknown task id or duplicate event | 200 with no action |

### Files (Track A)
```
supabase/config.toml                       # verify_jwt=false: create-task, manus-webhook, get-task-status, reconcile
supabase/migrations/0001_init.sql, 0002_reconcile_cron.sql
supabase/functions/create-task/index.ts    # Vapi adapter → AgentTaskRequest → Manus
supabase/functions/manus-webhook/index.ts
supabase/functions/get-task-status/index.ts
supabase/functions/reconcile/index.ts      # auth: CRON_SECRET
supabase/functions/_shared/{contracts,manus,vapi,db,tasks,log}.ts
supabase/functions/_shared/email/{prompt,notify}.ts   # STUBS → replaced by Track B
tests/*.test.ts, tests/fixtures/*.json     # deno test, fetch-stubbed providers
scripts/register-manus-webhook.ts          # webhook.create + connector.list sanity check
vapi/assistant.json                        # prompt + create_task/get_task_status tool defs
docs/implementation-plan.md, .env.example, CLAUDE.md, README.md
```
`log.ts` writes structured JSON and redacts PINs, keys and email content. The `research` intent uses a fixed generic prompt with no connectors.

Secrets: `MANUS_API_KEY`, `MANUS_WEBHOOK_URL`, `MANUS_GMAIL_CONNECTOR_ID`, `VAPI_TOOL_SECRET`, `TEST_USER_PHONE`, `TEST_USER_PIN`, `TEST_USER_EMAIL`, `CRON_SECRET`, plus Track B's `RESEND_API_KEY` and `RESEND_FROM`.

## Ordered tasks
**Stage 0, together:** agree on `contracts.ts`; set up the shared Supabase project, the Manus account and API key, and the Vapi account. Commit the scaffold to `main`:
- `supabase init`
- `contracts.ts` + email stubs
- `.env.example`
- CLAUDE.md, README
- `docs/implementation-plan.md`

Then both branches start from it.

**Track A (`feat/vapi-manus`):**
1. Migration `0001_init.sql` (profiles, user_integrations, agent_tasks, RLS, triggers, and `agent_tasks` added to the `supabase_realtime` publication) goes to `main` **first** and gets pushed to the shared project, so Track C can start on Lovable straight away. Add `docs/db-contract.md` for Track C with the tables, the RLS rules and example `supabase-js` queries.
2. `_shared/manus.ts` + signature verification. Unit tests use a locally generated RSA key pair (mocked). Then the `db.ts` transition helpers, with tests.
3. `create-task`: Vapi parsing, auth + PIN, insert, submit. Tests run against a stubbed Manus.
4. `manus-webhook` + `tasks.ts`, calling the stubbed `sendResultEmail`. Tests cover a duplicate event, a bad signature, an expired timestamp, and `ask`.
5. **First real milestone:** deploy, run `register-manus-webhook.ts`, curl `create-task` with a `research` intent → the real Manus task runs → a real webhook arrives → the row is `completed`.
6. `reconcile` + pg_cron, then `get-task-status`.
7. Vapi assistant + phone number. **Track A demo:** call → "create a research task" → Manus accepts → hang up → the webhook updates Supabase.

**Track C (Lovable, `NOVA-portal` repo):**
- Connect Lovable to the shared Supabase project.
- Build auth pages, a profile page, a task history page (subscribed to `agent_tasks` updates with Supabase Realtime, so the demo shows the status flipping live after the call) and an integrations page (a Gmail card, with Calendar, Slack and Home Assistant shown as "coming soon").

**Stage 2, integration:** merge `feat/gmail-integration`, which replaces `_shared/email/*`. Set `MANUS_GMAIL_CONNECTOR_ID` and the Resend secrets. Then run a real phone call for "summarize my important emails" and confirm the email arrives.

## External prerequisites
- Manus API key with credits
- Gmail OAuth set up in Manus on a dedicated test Gmail account (Track B)
- A Vapi phone number (it may need a Twilio import)
- A Supabase project with the CLI logged in
- A Resend account whose owner email is the test user's, or a verified domain

**Still unknown:** Manus webhook retry behavior, and typical task duration. The voice reply should set expectations that it may take a few minutes.

## Verification
- `deno test tests/`: signature valid/tampered/expired, Vapi parsing and auth, PIN lockout, transition guards, a duplicate webhook producing one notification, notification retry. All of these use mocks.
- Locally: `supabase start` + `supabase functions serve`, driven by curl with the fixtures.
- RLS test (a SQL script under `tests/sql/`): user A can't select user B's tasks, profiles or integrations, and anon users can't select anything.
- Real end to end: phone call → hang up → the portal shows the task flipping live → the row goes `submitted → completed` with `notified_at` set → the email is received → the task shows in the Manus UI. The README checklist marks each piece **mocked** or **verified real**.

---

## Update 2026-10-10 — merged with the Alo app (`SupabaseIntegrated`)

The plan above predates the team's Alo app. What changed after merging Nick's Supabase backend:

- **No Lovable, no separate portal repo.** The app is `NOVA_FE` (Next.js) in this repo, on the same Supabase project.
- **Caller identity:** callers are matched on Alo's SMS-verified `auth.users.phone` (`nova_user_id_by_phone`) plus the PIN. `assistant_profiles` and `phone_e164` were dropped.
- **Results:**
  - Every task is mirrored into Alo's `activity` table, which the app's History reads.
  - An email goes from the user's own Gmail to themselves, via Alo's Google OAuth.
  - Resend and `notify_email` were dropped. Users sign in by phone and have no email address.
- **Gmail:** the caller's own inbox is read through Alo's `_shared/tools.ts` and passed to Manus as data. The Manus Gmail connector is no longer used, because it can only see one account. Without Gmail connected, the task fails right away.
- `user_integrations` was dropped in favour of Alo's `connections`.
- **Migrations:** one shared history again (`supabase db push`); the separate `apply-migrations.sh` workaround was removed.

## Update 2026-10-10 — security levels and the reply-approval MVP

- **Layers:**
  - L1: caller ID = SMS-verified phone
  - L2: PIN on every call
  - L3: callback to the registered number
  - L4: approval in the Alo app
- **Risk assessment** (`_shared/policy.ts`):
  - low: research
  - medium: emails, calendar, status
  - high: reply / send / create event
  - High always requires L4. The user's `voice_settings.security_level = 'secure'` adds L3 to every call.
- **MVP flow** `reply_email`:
  - Manus reads the email the caller described (Gmail search in their own inbox) and returns a structured draft.
  - The task becomes `awaiting_approval`; the user approves/edits/rejects it in the app (`voice-approve`); it's then sent from their Gmail.
  - The recipient and subject are fixed from the original email's headers.
- **Not yet done:**
  - the frontend Approve/Reject UI and the Standard/Secure switch (Nick/Viktor)
  - approval expiry
  - Gmail threading
- **Later the same day: approval by phone (no internet needed).**
  - L4 can also be given on a confirmation call: Alo dials the registered number, reads the action, and the owner says the PIN + approve/cancel (`decide_action` tool).
  - The call is triggered by the Vapi end-of-call report (`vapi-events`) or a finished reply draft. Reconcile retries it (≤3).
  - Shared rules in `_shared/approval.ts`. A new `sending` status prevents double sends.
- **Security review fixes:**
  - replies go to `From` only;
  - no profile notes next to email/calendar data;
  - only the structured draft is ever sent;
  - a web call's customer number is ignored;
  - callback sessions are upserted.
- **MVP decision: no outbound calls.**
  - L3 is the user's **verification question**, asked by the agent in the call (bcrypt-hashed answer, 3 tries).
  - L4 is the **word-for-word read-back + explicit "yes"** on the call (`decide_action`), or the app.
  - Reply drafts are approved on a later call: "approve my pending email".
  - The callback prototype is kept on the local branch `archive/callback-approval`.
- **Prototype caller ID:** while Alo's SMS verification is paused, `user_metadata.contact_phone` also identifies callers (newest account wins; an SMS-verified phone always wins).
