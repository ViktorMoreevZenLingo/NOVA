# NOVA_VOICE — the Alo phone assistant

You call a phone number, ask Alo for something like *"check my recent emails and tell me which ones are important"*, and hang up. A cloud agent ([Manus](https://open.manus.ai/docs/v2)) **keeps working after the call ends**. When it finishes, the result shows up in the Alo app's **History**. If Gmail is connected, it also arrives as an email from your own Gmail to yourself.

The same Supabase project also runs the **Alo web app** (`NOVA_FE`). Users sign in with phone + SMS code, connect Google/Outlook, edit their profile and chat with the agent.

```
Phone ─▶ Vapi ─tool call─▶ create-task ─▶ agent_tasks ──trigger──▶ activity (app History)
                              │                │
                              │ caller = verified auth.users.phone + spoken PIN
                              ▼                ▼
                   Gmail (user's own OAuth) ─▶ Manus task.create
                                                   │
History + own Gmail ◀─ notifyTask ◀─ manus-webhook ◀─ task_stopped (signed, RSA-SHA256)
          reconcile (pg_cron, every 5 min): missed webhooks · submit retries · email retries

Alo app (NOVA_FE, Next.js) ─▶ Supabase Auth (phone OTP) · profiles · connections · activity
                           ─▶ Edge Functions: integrations (OAuth) · agent (chat) · account-delete
```

> Repo overview: [../README.md](../README.md). This folder holds the phone assistant's tests, scripts, Vapi configs and docs. Its Edge Functions live in the shared [`../supabase/functions`](../supabase/functions), because Supabase deploys from there.

## Team and ownership

| Area | Who | Where |
|---|---|---|
| Phone assistant: Vapi tools, Manus, task lifecycle, deploy CI | Oleg | `NOVA_VOICE/`, `supabase/functions/{create-task,get-task-status,manus-webhook,reconcile}`, `_shared/{caller,contracts,crypto,db,env,log,manus,tasks,vapi}.ts`, `_shared/email/`, `.github/` |
| Alo backend: auth, OAuth integrations, chat agent, account deletion | Nick | `supabase/functions/{integrations,agent,account-delete}`, `_shared/{http,providers,tools}.ts`, `supabase/README.md` |
| Alo frontend + design | Viktor, Nick | `NOVA_FE/` (Next.js), `Design/` (visual prototype) |
| Legacy Spring backend (reference only) | Viktor | `NOVA_BE/` |

- **One schema, one migration history** in `supabase/migrations`. The DB contract (who owns which table) is in [docs/db-contract.md](docs/db-contract.md).
- **The phone assistant reuses Alo's Gmail code** (`providers.ts`/`tools.ts`) instead of duplicating it.
- Plan and history: [docs/implementation-plan.md](docs/implementation-plan.md).

## Status: mocked vs verified

| Piece | Status |
|---|---|
| Shared schema: Alo tables + `agent_tasks`/`call_sessions`, `activity` mirror trigger, phone lookup, RLS, pg_cron job | ✅ all 5 migrations applied to the shared project (one history via `supabase db push`); verified locally by `NOVA_VOICE/tests/sql/rls.sql` and Alo's `supabase/tests/rls.sql` |
| create-task / manus-webhook / reconcile / get-task-status logic | ✅ 40 unit tests with fakes (`deno task test`) |
| Handlers ↔ real Postgres (phone-verified user, Alo profile context, activity mirror, notification lease) | ✅ integration test against local Supabase (`deno task test:integration`), Manus + Gmail faked |
| Deploy workflow → shared project `vlimtocbrxxnzobhkcoy` | ✅ migrations, secrets, Vault and all 7 functions deployed. Smoke check: `agent`/`integrations`/`account-delete`/`reconcile` → 401 (auth works), `manus-webhook` → 200 |
| `create-task` / `get-task-status` (hosted) | ❌ return 500 until the `TEST_USER_PIN` secret is set (the functions need it at startup) |
| Manus API key, `webhook.list`/`webhook.create` | ✅ real calls; webhook registered and **active** |
| Manus `task.create` / `task.detail` / `listMessages` / signed webhooks | ⚠️ not yet exercised for real: needs `TEST_USER_PIN` + a signed-up Alo user |
| Gmail summary from the caller's own inbox (`_shared/email/prompt.ts`) | ⚠️ written on top of Alo's Gmail tools; not yet run with a real Google connection |
| Result email from own Gmail to self (`_shared/email/notify.ts`) | ⚠️ same as above |
| Vapi assistant + phone number | ⚠️ config in `vapi/`, not yet created in Vapi |
| End-to-end phone call | ❌ not yet |

### Next steps
1. Add the `TEST_USER_PIN` GitHub secret, then re-run the deploy.
2. Sign up in the Alo app with the demo phone number and connect Gmail under Integrations.
3. Run the first real task: curl `create-task` with `tests/fixtures/vapi-create-task.json`, after putting the demo phone and PIN into the fixture. Check that the row goes `submitted → completed`, History updates, and the email arrives.
4. Create the Vapi tools, assistant and phone number from `vapi/`, then make a real call.
5. Open a PR `feat/vapi-manus` → `main`. After merging, deploy only through CI from `main`.

## Phone task lifecycle

```
pending ─▶ submitted ─▶ completed
   │           ├──────▶ needs_input ─▶ completed   (user continued in the Manus UI)
   │           └──────▶ failed                      (Manus reported an error)
   ├─▶ submit_failed ─(retry ×3 via reconcile)─▶ submitted | failed
   └─▶ failed right away for non-retryable errors (e.g. Gmail not connected)
```

- **App History:** every `agent_tasks` change is mirrored into `public.activity` by a trigger. It has the same id and `type = 'task'`. `completed` and `failed` both show as `done`, with the result or the reason in `detail`. The app picks it up on reload; `activity` isn't in the Realtime publication yet.
- **Status changes:** every transition is a conditional `UPDATE … WHERE status IN (…)`, so duplicate webhooks do nothing.
- **Delivery outside the app:**
  - Each state change (question, completion, failure) gets one email, sent under a **lease**: `claim_notification` → send (20s timeout) → `mark_notified`, or `release_notification` if the send fails.
  - If a sender crashes mid-send, its lease expires after 10 minutes and reconcile retries, up to 5 attempts.
  - `mark` and `release` only act on their own lease, so a late sender can't undo a newer claim.
  - The email goes from the user's own Gmail to that same address. Without Gmail, History is the only channel.
- **Retries and recovery:**
  - A Vapi tool-call retry (same `toolCallId`) never creates a second task.
  - **Missed webhooks:** reconcile polls `task.detail` for `submitted` and `needs_input` tasks older than 3 minutes. Overlapping runs are prevented by `claim_reconcile_batch` (`FOR UPDATE SKIP LOCKED`).
  - **Orphaned Manus tasks:** each Manus title ends with `#nova:<row id>`. If `task.create` timed out on our side but Manus ran it anyway, its webhook adopts the row instead of being dropped.

## Security

- **Vapi → create-task / get-task-status:** a Vapi *Bearer Token* credential, compared in constant time.
- **Caller identity:**
  - The caller's number has to match an Alo account's **SMS-verified** phone (`auth.users.phone`, via `nova_user_id_by_phone`). Caller ID alone isn't trusted, so the caller must also say a **6-digit PIN** (`TEST_USER_PIN`, one shared PIN for the MVP).
  - Lockout: 3 wrong PINs lock the call, and 10 wrong PINs per user per hour lock that user across all calls.
  - Leave `DEMO_WEBCALL_PHONE` unset outside of testing: it lets anyone with your Vapi public key try PINs through web calls.
- **Gmail isolation:**
  - "Summarize my emails" reads **only the caller's own** Gmail, through their Alo Google connection. The emails go to Manus as data, and no Manus Gmail connector is used.
  - Without Gmail connected, the task fails right away with "connect Gmail in the app". There is no fallback to a shared inbox.
- **Result email:** goes from the user's Gmail to that same address only. The recipient is never chosen by the LLM. This system notification to the account owner skips the chat agent's per-send approval, which exists for emails to other people.
- **Manus webhook:** RSA-SHA256 signature over `{timestamp}.{url}.{sha256(body)}`, rejected if older than 5 minutes. Unsigned requests (Manus' registration ping) get a 200 and are ignored.
- **Manus prompts:**
  - research tasks take no actions with external side effects
  - email and web content is treated as untrusted
  - the user's profile notes are sent as context only, capped at 1,500 characters
- **Data access:** users can read only their own `agent_tasks` and `activity` (RLS). All writes go through the service role. `call_sessions` is service-only. Deleting an Alo account cascades to all phone-assistant rows.

## Setup

Prerequisites: [Supabase CLI](https://supabase.com/docs/guides/cli), [Deno 2](https://deno.com), Docker (for local). Alo-specific provider setup (Phone Auth, Google/Outlook OAuth, Places, OpenAI) is in [supabase/README.md](../supabase/README.md).

### 1. External accounts
- **Manus:**
  - create an API key (Settings → Developers)
  - check that your plan has credits
  - no Gmail connector is needed, because Gmail comes from the user's Alo connection
- **Vapi:**
  - account + phone number
  - a **Bearer Token credential** (token = `VAPI_TOOL_SECRET`)
- **Supabase:** the shared project (`vlimtocbrxxnzobhkcoy`).

### 2. Deploy (GitHub Actions)
Deploys are done by [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). It runs on every push to `main` or `feat/vapi-manus` that touches `supabase/**` or `NOVA_VOICE/**`, and can also be started from the Actions tab. Each run:
1. runs the unit tests
2. runs `supabase db push` (one shared history; our first two migrations get marked as applied, which is idempotent)
3. sets the function secrets
4. writes the cron job's Vault secrets (`project_url`, `cron_secret`)
5. deploys **all 7 functions**
6. registers the Manus webhook (idempotent)
7. smoke-checks that the functions boot

> CI from `main` should be the only way to deploy, so manual deploys from a laptop don't overwrite it.

**Repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Used by | Where to get it |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | CI | supabase.com → Account → Access Tokens |
| `SUPABASE_PROJECT_REF` | CI | `vlimtocbrxxnzobhkcoy` |
| `SUPABASE_DB_PASSWORD` | CI | Project Settings → Database |
| `MANUS_API_KEY` | phone assistant | manus.im → Settings → Developers |
| `VAPI_TOOL_SECRET` | phone assistant | random string (`openssl rand -hex 32`); the same value goes into the Vapi Bearer credential |
| `TEST_USER_PIN` | phone assistant | 6 digits of your choice |
| `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `GOOGLE_PLACES_API_KEY` | Alo app | see [supabase/README.md](../supabase/README.md) |

**Repository variables:**
- `APP_URL`
- `OPENAI_MODEL`
- `APP_TIMEZONE`
- `DEMO_WEBCALL_PHONE`

`CRON_SECRET` and `MANUS_WEBHOOK_URL` are generated by the workflow. Any secret that isn't in GitHub is **left as it is** in Supabase, so values Nick set by hand keep working.

### 3. Manus webhook
The deploy workflow registers it automatically. To run it by hand:
```bash
MANUS_API_KEY=... MANUS_WEBHOOK_URL=https://vlimtocbrxxnzobhkcoy.supabase.co/functions/v1/manus-webhook \
  deno run --allow-env --allow-net NOVA_VOICE/scripts/register-manus-webhook.ts
```

### 4. Vapi
1. Create the two tools from `vapi/tool-create-task.json` and `vapi/tool-get-task-status.json`, replacing `<project-ref>` and `<vapi-bearer-credential-id>`.
2. Create the assistant from `vapi/assistant.json` and set its `toolIds`.
3. Attach the assistant to the phone number.

## Development

Run these from `NOVA_VOICE/`; `supabase` commands run from the repo root.

```bash
deno task test        # unit tests (no network, fakes for DB/Manus/email)
deno task check       # type-check all functions (ours + Alo's), scripts and tests
deno task lint        # phone-assistant code only
deno task fmt         # phone-assistant code only (Alo's files keep their own style)

supabase start        # local stack (Docker); applies all migrations
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<from `supabase status`> deno task test:integration
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f tests/sql/rls.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f ../supabase/tests/rls.sql
```

## Demo runbook
1. Sign up in the Alo app with your phone number. Connect **Gmail** under Integrations, and optionally fill in your profile.
2. Open **History** in the app.
3. Call the Vapi number from that phone and say: *"Check my recent emails and tell me which ones are important."*
4. Alo asks for the PIN, confirms the task and gives a reference. **Hang up.** The task appears in History as in progress.
5. A few minutes later, the Manus webhook completes it. History (reload) shows it as done with the summary, and the same summary arrives in your Gmail inbox from yourself.

## Known limitations / open decisions
- Manus webhook retry semantics aren't documented. Reconcile is the safety net.
- If Manus asks a question (`needs_input`), the user sees it in History and by email, and continues in the Manus UI. There's no voice follow-up yet.
- `create-task` waits for Manus `task.create` (15s client timeout) before answering. The Vapi tool timeout is set to 30s.
- The webhook treats any `stop_reason` other than `ask` as `finish`. Errored tasks are caught by reconcile through `task.detail`.
- Vapi calls themselves (transcript, duration) aren't recorded in History yet. The next step is Vapi's end-of-call report → `activity` with `type = 'call'`.
- The PIN is one shared secret for the MVP. Next step: a per-user PIN, set in the Alo profile and stored hashed.
