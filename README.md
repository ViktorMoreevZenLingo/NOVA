# NOVA — always-on AI assistant you can call

You call a phone number, ask Nova for something like *"check my recent emails and send me a summary of the important ones"*, and hang up. A cloud agent ([Manus](https://open.manus.ai/docs/v2)) **keeps working after the call ends**. When it finishes, the result is saved in Supabase and emailed to you.

```
Phone ─▶ Vapi ─tool call─▶ create-task ─▶ agent_tasks ─▶ Manus task.create (+ Gmail connector)
                                                           │
Email ◀─ sendResultEmail ◀─ manus-webhook ◀─ task_stopped ─┘   (signed, RSA-SHA256)
         reconcile (pg_cron, every 5 min): missed webhooks · submit retries · email retries
Portal (Lovable) ─▶ reads assistant_profiles / user_integrations / agent_tasks via RLS (+ Realtime)
```

## Team and ownership

| Track | Who | Scope | Where |
|---|---|---|---|
| A — Voice & Agent | voice/agent dev | Vapi, Edge Functions, Manus client, webhook, DB schema | `feat/vapi-manus` — everything except `_shared/email/` |
| B — Email | teammate | Gmail connector in Manus, `buildGmailPrompt`, `sendResultEmail` (Resend) | `feat/gmail-integration` — `supabase/functions/_shared/email/**`, `tests/email/**` |
| C — Portal | third dev | Lovable web app: sign-up/login, task history, integrations page | separate `NOVA-portal` repo; reads [docs/db-contract.md](docs/db-contract.md) |

Shared TypeScript contract between A and B: [`supabase/functions/_shared/contracts.ts`](supabase/functions/_shared/contracts.ts). Only change it if the other track agrees. Full plan: [docs/implementation-plan.md](docs/implementation-plan.md).

## Status: mocked vs verified

| Piece | Status |
|---|---|
| DB schema, RLS, atomic helpers (notification lease, reconcile batch claim, PIN counters), pg_cron job | ✅ applied to local Supabase; verified by `tests/sql/rls.sql` |
| create-task / manus-webhook / reconcile / get-task-status logic | ✅ 40 unit tests with fakes (`deno task test`) |
| Handlers ↔ real Postgres (PostgREST, SQL claim/release, dedupe) | ✅ integration test against local Supabase (`deno task test:integration`), Manus + email faked |
| Manus webhook signature verification | ✅ unit-tested with a locally generated RSA key (not yet against real Manus) |
| Manus API calls (task.create, task.detail, listMessages, webhook.publicKey) | ⚠️ written from the official docs; **not yet run against the real API** |
| Gmail prompt (`_shared/email/prompt.ts`) | 🟡 **stub**: Track B replaces it |
| Email notification (`_shared/email/notify.ts`) | 🟡 **mock**: it only logs `email.mock_sent`. Track B replaces it with Resend |
| Vapi assistant + phone number | ⚠️ config in `vapi/`, not yet created in Vapi |
| pg_cron reconcile schedule | ⚠️ migration written; Vault secrets set by the deploy workflow |
| Deploy workflow (`.github/workflows/deploy.yml`) | ✅ deploys to the shared project; our tables coexist with Lovable's |
| Hosted functions | ✅ deployed; `create-task` / `get-task-status` need `TEST_USER_PIN` to boot |
| End-to-end phone call | ❌ not yet |

## Repository layout

```
supabase/
  config.toml                  # verify_jwt=false for our 4 functions (they authenticate callers themselves)
  migrations/                  # 001 init schema + RLS, 002 pg_cron reconcile schedule
  functions/
    create-task/               # Vapi tool `create_task`: auth → insert row → Manus task.create
    get-task-status/           # Vapi tool `get_task_status`
    manus-webhook/             # Manus task_stopped → verify signature → update row → email
    reconcile/                 # cron backstop: poll stale tasks, retry submits and emails
    _shared/
      contracts.ts             # A↔B interface
      manus.ts                 # Manus v2 client + signature verification
      db.ts                    # service-role data access, conditional state transitions
      tasks.ts                 # lifecycle: submit, applyManusStop, failTask, notifyTask
      caller.ts                # caller auth: phone → profile + spoken PIN, lockout
      vapi.ts                  # tool-calls parsing / response format, bearer check
      log.ts                   # JSON logs with redaction (no PINs, secrets or email content)
      email/                   # Track B (stubs until merged)
tests/                         # deno tests (fakes for DB/Manus/email), sql/rls.sql, fixtures/
vapi/                          # assistant + tool definitions for the Vapi dashboard/API
scripts/register-manus-webhook.ts
docs/                          # implementation plan, DB contract for the portal
```

## Task lifecycle

```
pending ─▶ submitted ─▶ completed
   │           ├──────▶ needs_input ─▶ completed   (user continued in the Manus UI)
   │           └──────▶ failed                      (Manus reported an error)
   └─▶ submit_failed ─(retry ×3 via reconcile)─▶ submitted | failed
```

- Every transition is a conditional `UPDATE … WHERE status IN (…)`, so duplicate webhooks do nothing.
- **Emails:**
  - Each state change (question, completion, failure) gets one email, sent under a **lease**: `claim_notification` → send (20s timeout) → `mark_notified`, or `release_notification` if the send fails.
  - `notified_at` is set only after a successful send.
  - If a sender crashes mid-send, its lease expires after 10 minutes and reconcile retries, up to 5 attempts.
  - `mark` and `release` only act on their own lease, so a late sender can't undo a newer claim.
- A Vapi tool-call retry (same `toolCallId`) never creates a second task.
- **Missed webhooks:** reconcile polls `task.detail` for `submitted` and `needs_input` tasks older than 3 minutes. A `needs_input` task can finish after the user continues it in the Manus UI.
- **Overlapping cron runs:** `claim_reconcile_batch` claims rows (`FOR UPDATE SKIP LOCKED` + bumps `updated_at`), so two runs never resubmit the same task.
- **Orphaned Manus tasks:** each Manus title ends with `#nova:<row id>`. If `task.create` timed out on our side but Manus ran the task anyway, its webhook adopts the `submit_failed` row instead of being dropped. Duplicate runs for an already-submitted row are ignored.

## Security

- **Vapi → create-task / get-task-status:** a Vapi *Bearer Token* credential, compared in constant time.
- **Caller identity:**
  - Caller ID only selects the profile (`assistant_profiles.phone_e164`). The caller must also say a **6-digit PIN** (`TEST_USER_PIN`, one shared PIN for the MVP).
  - Lockout: 3 wrong PINs lock the call, and 10 wrong PINs per profile per hour lock that profile across all calls.
  - Once the PIN is verified, it isn't asked again during that call.
  - Leave `DEMO_WEBCALL_PHONE` unset outside of testing: it lets anyone with your Vapi public key try PINs through web calls.
- **Manus → manus-webhook:** RSA-SHA256 signature over `{timestamp}.{url}.{sha256(body)}`, rejected if older than 5 minutes. Unsigned requests (Manus' registration ping) get a 200 and are ignored.
- **Recipients:**
  - The recipient is always the caller's `assistant_profiles.notify_email`. That's the sign-up email, and users can't edit it.
  - Keep email confirmation enabled in Supabase Auth.
  - Profiles without an email are refused.
  - The LLM never chooses a recipient.
- **Manus prompts:**
  - research tasks are told to take no actions with external side effects
  - Gmail access is read-only by instruction
  - email/web content is treated as untrusted
  - Use a **dedicated test Gmail account**.
- **Secrets** live only in Supabase secrets/Vault. The `agent_tasks` table is readable only by its owner (RLS). All writes go through the service role.

## Setup

Prerequisites: [Supabase CLI](https://supabase.com/docs/guides/cli), [Deno 2](https://deno.com), Docker (for local).

### 1. External accounts
- **Manus:**
  - create an API key (Settings → Developers)
  - (Track B) authorize **Gmail** in Manus with the dedicated test Gmail account. API tasks can only use connectors authorized in the web app.
  - check that your plan has credits
- **Vapi:**
  - account + phone number
  - a **Bearer Token credential** (token = `VAPI_TOOL_SECRET`)
- **Supabase:** a project, then `supabase login && supabase link --project-ref <ref>`
- **Resend (Track B):** API key. Without a verified domain, Resend only delivers to the account owner's email, so the demo user should use that email.

### 2. Deploy (GitHub Actions)
Deploys are done by [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). It runs on every push to `main` or `feat/vapi-manus` that touches `supabase/**`, and can also be started from the Actions tab. Each run:
1. runs the unit tests
2. lists the existing tables (for syncing with Lovable), then applies our migrations with [`scripts/apply-migrations.sh`](scripts/apply-migrations.sh)
3. sets the function secrets
4. writes the cron job's Vault secrets (`project_url`, `cron_secret`)
5. deploys all 4 functions
6. registers the Manus webhook (idempotent) and prints the installed Manus connectors
7. smoke-checks that the functions boot

**Repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Where to get it |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | supabase.com → Account → Access Tokens |
| `SUPABASE_PROJECT_REF` | the `xxxx` in `https://xxxx.supabase.co` |
| `SUPABASE_DB_PASSWORD` | Project Settings → Database |
| `MANUS_API_KEY` | manus.im → Settings → Developers |
| `VAPI_TOOL_SECRET` | random string (`openssl rand -hex 32`); the same value goes into the Vapi Bearer credential |
| `TEST_USER_PIN` | 6 digits of your choice |
| `RESEND_API_KEY` | (Track B) resend.com |

Optional **repository variables**:
- `MANUS_GMAIL_CONNECTOR_ID` (defaults to the documented Gmail UUID)
- `DEMO_WEBCALL_PHONE`
- `RESEND_FROM`

`CRON_SECRET` and `MANUS_WEBHOOK_URL` are generated by the workflow, so you don't add them yourself.

After the first deploy, register the demo user's phone in the Supabase SQL editor. The user must have signed up first, through the portal or the Auth dashboard:
```sql
update public.assistant_profiles set phone_e164 = '+359...' where notify_email = 'demo@example.com';
```

> **Why not `supabase db push`?** The Lovable portal writes its own migrations to the same Supabase project. The CLI refuses to push while the shared history has entries this repo doesn't know about. So our migrations are tracked separately in `public.nova_schema_migrations`, and Lovable keeps `supabase_migrations`. **Don't run `supabase db push` or `migration repair` against the shared project.**

Deploying manually without GitHub works too:
1. `supabase link`
2. `PGHOST=<pooler host> PGPORT=5432 PGUSER=postgres.<ref> PGPASSWORD=... PGDATABASE=postgres scripts/apply-migrations.sh`
3. `supabase secrets set --env-file <file>` (see `.env.example`)
4. `supabase functions deploy`
5. set the Vault secrets with `select public.nova_set_vault_secret('project_url', ...)` and `select public.nova_set_vault_secret('cron_secret', ...)`

### 3. Manus webhook (+ list connectors)
The deploy workflow does this automatically. To run it by hand:
```bash
MANUS_API_KEY=... MANUS_WEBHOOK_URL=https://<ref>.supabase.co/functions/v1/manus-webhook \
  deno run --allow-env --allow-net scripts/register-manus-webhook.ts
```
The script prints the installed connectors. Set `MANUS_GMAIL_CONNECTOR_ID` from that output.

### 4. Vapi
1. Create the two tools from `vapi/tool-create-task.json` and `vapi/tool-get-task-status.json`, replacing `<project-ref>` and `<vapi-bearer-credential-id>`.
2. Create the assistant from `vapi/assistant.json` and set its `toolIds`.
3. Attach the assistant to the phone number.

## Development

```bash
deno task test        # unit tests (no network, fakes for DB/Manus/email)
# integration: real local Postgres, fake Manus/email (needs `supabase start`)
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<from `supabase status`> deno task test:integration
deno task check       # type-check functions, scripts and tests
deno task lint

supabase start        # local stack (Docker); applies migrations
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f tests/sql/rls.sql

cp .env.example supabase/functions/.env   # fill in values
supabase functions serve
curl -X POST http://127.0.0.1:54321/functions/v1/create-task \
  -H "Authorization: Bearer $VAPI_TOOL_SECRET" -H "Content-Type: application/json" \
  -d @tests/fixtures/vapi-create-task.json
```
Locally, the demo profile has to exist first. Sign up a user in local Auth, then set `phone_e164 = '+15550001111'` on their profile to match the fixture.

## Demo runbook
1. Open the portal's task history, or the `agent_tasks` table in the Supabase dashboard.
2. Call the Vapi number and say: *"Check my recent emails, find the important ones and email me a summary."*
3. Nova asks for your PIN, then confirms the task and gives a reference. **Hang up.**
4. Show the task running in Manus (`manus_task_url`), and the row in `submitted`.
5. A few minutes later: the webhook flips the row to `completed`, the portal updates live, and the summary email arrives.

## Known limitations / open decisions
- **Multi-user Gmail is undecided.** A Manus Gmail connector belongs to one Manus account. Today every `summarize_emails` task reads the demo account's Gmail. Per-user Gmail would need direct Google OAuth (Track B fallback).
- Manus webhook retry semantics aren't documented. Reconcile is the safety net.
- `create-task` waits for Manus `task.create` (15s client timeout) before answering. The Vapi tool timeout is set to 30s so the LLM doesn't re-invoke the tool with a new `toolCallId`. If that turns out slow in practice, move the submit into `EdgeRuntime.waitUntil`.
- The webhook treats any `stop_reason` other than `ask` as `finish`. Errored tasks are caught by reconcile through `task.detail`. Confirm the real payloads with Manus.
- If Manus pauses to ask a question (`needs_input`), the user gets an email with a link and continues in the Manus UI. There's no voice follow-up yet.
- Manus Gmail *send* actions need an explicit confirmation (`task.confirmAction`) that nobody can give after hang-up. That's why the result is emailed by our backend, not by Manus.
