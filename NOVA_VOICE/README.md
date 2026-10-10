# NOVA_VOICE — the Alo phone assistant

You call a phone number, ask Alo for something like *"check my recent emails and tell me which ones are important"* or *"reply to Ivan's last email, tell him I'll be there at 5"*, and hang up. A cloud agent ([Manus](https://open.manus.ai/docs/v2)) **keeps working after the call ends**. When it finishes, the result shows up in the Alo app's **History**. If Gmail is connected, it also arrives as an email from your own Gmail to yourself.

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
| Security levels: risk policy, PIN/lockout, Secure callbacks (L3), approval by phone and app (L4), reply drafts, double-send protection | ✅ 23 unit tests (`tests/security.test.ts`, `tests/approval_phone.test.ts`) + SQL checks; Vapi outbound calls and real Gmail sending not yet exercised |
| In-app Approve/Reject + Standard/Secure switch | ⚠️ optional for the MVP (phone approval works without the app); **frontend work**, API in [docs/db-contract.md](docs/db-contract.md#for-the-frontend) |

### Next steps
1. Add the `TEST_USER_PIN` GitHub secret, then re-run the deploy.
2. Sign up in the Alo app with the demo phone number and connect Gmail under Integrations.
3. Run the first real task: curl `create-task` with `tests/fixtures/vapi-create-task.json`, after putting the demo phone and PIN into the fixture. Check that the row goes `submitted → completed`, History updates, and the email arrives.
4. Create the Vapi tools, assistant and phone number from `vapi/`, and add `VAPI_API_KEY` / `VAPI_ASSISTANT_ID` / `VAPI_PHONE_NUMBER_ID`, which are needed for confirmation calls. Then make a real call.
5. Frontend (optional for the MVP): Approve/Reject (+ edit) on History items waiting for approval, plus the Standard/Secure and "approve by phone" settings.
6. Open a PR `feat/vapi-manus` → `main`. After merging, deploy only through CI from `main`.

## Phone task lifecycle

```
reads (research, summarize_emails, calendar):
pending ─▶ submitted ─▶ completed
   │           ├──────▶ needs_input ─▶ completed   (user continued in the Manus UI)
   │           └──────▶ failed                      (Manus reported an error)
   ├─▶ submit_failed ─(retry ×3 via reconcile)─▶ submitted | failed
   └─▶ failed right away for non-retryable errors (e.g. Gmail not connected)

writes, MVP flow "read → draft → approve → send":
reply_email:  pending ─▶ submitted (Manus drafts) ─▶ awaiting_approval ─┬─ approve (call or app) ─▶ sending ─▶ completed (sent) | failed
send_email / create_calendar_event:          awaiting_approval ────────┴─ reject ──────────────────▶ rejected (nothing sent)
```
`sending` is never re-entered automatically. If an approved send crashes, reconcile marks it `failed` with "check Gmail/Calendar before trying again", so an action can't go out twice.

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

## Security levels and access layers

Every phone request is **assessed for risk**. The risk decides which **verification layers** it needs, and the user's own setting is a floor on top of that. Every decision is recorded on the task (`risk_level`, `layers`).

| Layer | Proves | How |
|---|---|---|
| **L1** caller ID | the call comes from the account's number | caller's number = the **SMS-verified** phone of an Alo account |
| **L2** PIN | the caller knows the secret | 6-digit PIN on **every** call (3 wrong = call locked, 10/hour = account locked) |
| **L3** callback | the caller holds the real line | Alo hangs up and **calls the registered number back** (Vapi outbound); requests continue on that call |
| **L4** approval | the account owner wants *this exact* action | **by phone (default, no internet needed):** Alo calls the registered number, reads the action aloud, and the owner says the **PIN** + "approve" (or "cancel"). **Or in the Alo app** when online (approve, edit or reject). Whichever comes first wins. |

| Risk (automatic) | Requests | Standard | Secure |
|---|---|---|---|
| **low** | research (no personal data) | L1 + L2 | L1 + L2 + L3 |
| **medium** | summarize emails (Gmail search on the caller's words), calendar questions, task status | L1 + L2 | L1 + L2 + L3 |
| **high** | reply to an email, send an email, create an event | L1 + L2 + **L4** | L1 + L2 + L3 + **L4** |

- **The level is chosen in the Alo app.** It's stored in `voice_settings.security_level` (`standard` by default, or `secure`). A Secure account gets a callback on every call.
- **Approval by phone can be turned off** with `voice_settings.approve_by_call` (default on). With it off, approval happens in the app only.
- **When the confirmation call comes:**
  - for something dictated on a call: right after you hang up (Vapi end-of-call report → `vapi-events`);
  - for a reply draft: as soon as it's ready;
  - if missed: reconcile retries, at most 3 calls, 15 minutes apart. You can also call Alo and say *"approve my pending email"* to get the call sooner.
- **Approving by phone always needs the PIN on that call.** The call proves you have the line (we dial the registered number), the PIN proves you know the secret, and the read-back proves the intent.
- **Nothing that sends or changes data runs without L4.** The voice side only prepares the action. Its content is validated: one recipient, no header injection, times must carry a timezone. A reply's recipient and subject come from the original email's headers, never from the AI.
- **Approval is consumed before the action runs**, and a provider error is never retried automatically, so an action can't run twice. This follows the same rule as Alo's chat agent.
- **Callbacks need `VAPI_API_KEY`, `VAPI_ASSISTANT_ID` and `VAPI_PHONE_NUMBER_ID`.** If they're missing or Vapi fails, requests that need L3 are **refused**, never let through. There is one callback per inbound call, and it always goes to the number registered in Auth, never to the number the call came from.

## Security

- **Vapi → create-task / get-task-status:** a Vapi *Bearer Token* credential, compared in constant time.
- **Caller identity:**
  - The caller's number has to match an Alo account's **SMS-verified** phone (`auth.users.phone`, via `nova_user_id_by_phone`). Caller ID alone isn't trusted, so the caller must also say a **6-digit PIN** (`TEST_USER_PIN`, one shared PIN for the MVP).
  - Lockout: 3 wrong PINs lock the call, and 10 wrong PINs per user per hour lock that user across all calls.
  - Leave `DEMO_WEBCALL_PHONE` unset outside of testing: it lets anyone with your Vapi public key try PINs through web calls.
- **Gmail/Calendar isolation:**
  - Email and calendar requests read **only the caller's own** Gmail/Calendar, through their Alo Google connection. The emails go to Manus as data, and no Manus Gmail connector is used.
  - Without Gmail connected, the task fails right away with "connect Gmail in the app". There is no fallback to a shared inbox.
- **Result email:** goes from the user's Gmail to that same address only. The recipient is never chosen by the LLM. This system notification to the account owner skips the chat agent's per-send approval, which exists for emails to other people.
- **Manus webhook:** RSA-SHA256 signature over `{timestamp}.{url}.{sha256(body)}`, rejected if older than 5 minutes. Unsigned requests (Manus' registration ping) get a 200 and are ignored.
- **Manus prompts:**
  - research tasks take no actions with external side effects
  - email and web content is treated as untrusted
  - the user's profile notes are sent as context only, capped at 1,500 characters
- **App approval API (`voice-approve`):** the user's Alo session (phone-verified) is required, and only the task's owner can decide on it. Tasks that aren't `awaiting_approval` return 409.
- **Data access:** users can read only their own `agent_tasks` and `activity`, and only their own `voice_settings` (RLS). All writes go through the service role. `call_sessions` is service-only. Deleting an Alo account cascades to all phone-assistant rows.

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
| `VAPI_API_KEY` | phone assistant (confirmation calls + Secure callbacks) | Vapi dashboard → API Keys → **Private** key |
| `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `GOOGLE_PLACES_API_KEY` | Alo app | see [supabase/README.md](../supabase/README.md) |

**Repository variables:**
- `APP_URL`
- `OPENAI_MODEL`
- `APP_TIMEZONE`
- `DEMO_WEBCALL_PHONE`
- `VAPI_ASSISTANT_ID` (the Alo assistant used for callbacks)
- `VAPI_PHONE_NUMBER_ID` (the Vapi number callbacks are made from)

`CRON_SECRET` and `MANUS_WEBHOOK_URL` are generated by the workflow. Any secret that isn't in GitHub is **left as it is** in Supabase, so values Nick set by hand keep working.

### 3. Manus webhook
The deploy workflow registers it automatically. To run it by hand:
```bash
MANUS_API_KEY=... MANUS_WEBHOOK_URL=https://vlimtocbrxxnzobhkcoy.supabase.co/functions/v1/manus-webhook \
  deno run --allow-env --allow-net NOVA_VOICE/scripts/register-manus-webhook.ts
```

### 4. Vapi
1. Create the three tools from `vapi/tool-create-task.json`, `vapi/tool-get-task-status.json` and `vapi/tool-decide-action.json`, replacing `<project-ref>` and `<vapi-bearer-credential-id>`.
2. Create the assistant from `vapi/assistant.json` and set its `toolIds`. The assistant's `server` URL (`vapi-events`, same Bearer credential) receives the end-of-call report that triggers confirmation calls.
3. Attach the assistant to the phone number.
4. Set `VAPI_API_KEY` (secret), and `VAPI_ASSISTANT_ID` and `VAPI_PHONE_NUMBER_ID` (variables). These are needed for **all outbound calls**: confirmation calls and Secure callbacks.

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

**MVP flow: read → draft → approve → send (no internet needed)**
1. Call and say: *"Reply to Ivan's last email, tell him I'll be there at 5."* Alo asks for the PIN and says it will call you back with the draft. Hang up.
2. Manus reads that email (found with a Gmail search in your own inbox) and drafts the reply. The recipient is always the original sender.
3. **Alo calls you back** and reads it: *"…a reply to ivan@example.com, subject 'Re: Meeting'. It says: … To send it, tell me your PIN and say approve."*
4. Say the PIN and "approve". It's sent from your Gmail, and History shows **Sent**. Saying "cancel" sends nothing.
5. When you're online you can do step 4 in the app instead, and edit the text first.
4. **Secure mode:** in the app, set the voice security level to Secure. The next call ends after the PIN with *"I'll call you back"*, and Alo calls your registered number. Repeat the request on that call.

## Known limitations / open decisions
- Manus webhook retry semantics aren't documented. Reconcile is the safety net.
- If Manus asks a question (`needs_input`), the user sees it in History and by email, and continues in the Manus UI. There's no voice follow-up yet.
- `create-task` waits for Manus `task.create` (15s client timeout) before answering. The Vapi tool timeout is set to 30s.
- The webhook treats any `stop_reason` other than `ask` as `finish`. Errored tasks are caught by reconcile through `task.detail`.
- Vapi calls themselves (transcript, duration) aren't recorded in History yet. The next step is Vapi's end-of-call report → `activity` with `type = 'call'`.
- The PIN is one shared secret for the MVP. Next step: a per-user PIN, set in the Alo profile and stored hashed.
- Replies go out as a new email with `Re: <subject>` to the original sender. They aren't threaded into the Gmail conversation, because Alo's `send_email` has no `threadId`.
- Approvals don't expire yet. Next step: auto-reject after 24h.
- To change a draft by phone, cancel it and ask again. Editing the text is only possible in the app.
- Prompt injection: email and calendar text goes to Manus as data, with strict instructions to answer only from that data. A Manus agent can still browse, so a malicious email could in theory make it fetch a URL. Profile notes are never included next to that data, and **nothing is sent without L4**.
- Callbacks start the conversation fresh: the caller repeats the request on the callback.
