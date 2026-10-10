> Current routing and rollout: [Direct voice requests](../docs/FastVoiceRequests.md). Everyday reads/writes use synchronous NOVA AI tools; only explicitly delegated work uses Manus.

# NOVA_VOICE — the NOVA AI phone assistant

New Vapi requests now enter NOVA AI's durable `alo_tasks` queue through the existing `create-task` and `get-task-status` URLs. Work starts now, after an authenticated end-of-call report, or once at a scheduled time. Manus runs the reasoning; NOVA AI executes approved integration operations and stores results in History. Email is sent only when requested. Callback/SMS requests are durable handoffs for the delivery worker.

The NOVA AI browser prototype still uses Supabase anonymous accounts while SMS authentication is paused. Live telephone calls match the caller number to the web account through the authenticated Vapi webhook. PIN and security-question prompts are disabled at the product owner’s request; exact-action read-back approval remains. Browser-supplied caller numbers cannot authorize telephone access.

```
Vapi tools → caller checks → create-task adapter → alo_tasks → activity / History
Vapi end-of-call-report ──────────────────────────┘
minute scheduler → task-worker → Manus v2 ↔ validated NOVA AI integration tools
signed Manus webhook → wake worker; polling reconciles missed events
completed task → separate email / callback / SMS delivery state
```

Latency findings and next steps: [Voice latency plan](../docs/VoiceLatencyPlan.md).

Full contract, permissions, recovery rules and deployment steps: [ManusIntegration](../docs/ManusIntegration.md).

## NOVA Coach + employee voice

A personal AI coach for employees by phone or browser, plus anonymous voice check-ins whose aggregates (≥5 people) go to managers, leadership and HR. Plan, principles and design: [docs/coach-mvp-plan.md](docs/coach-mvp-plan.md). Schema contract: [docs/db-contract.md](docs/db-contract.md#nova-coach--employee-voice).

```
employee ─phone─▶ Vapi "NOVA Coach"/"NOVA Pulse" ─tool-calls─▶ coach-tools ─┐
employee ─browser─▶ coach (live_session/live_tool, OpenAI Realtime) ────────┤─▶ coach_* (private) / survey_responses (anonymous)
pg_cron ─▶ coach-worker ─▶ Vapi POST /call (follow-ups, pulse) ──────────────┘
manager / leader / HR ─browser─▶ insights_* RPCs (aggregates, ≥5 people) + coach.recommendations
```

| Piece | Where |
|---|---|
| Migration | `supabase/migrations/20261010190000_coach_and_employee_voice.sql` |
| Functions | `coach-tools` (Vapi secret), `coach` (signed-in user), `coach-worker` (cron secret); shared code in `supabase/functions/_shared/coach/` |
| Prompts + tool schemas (single source) | `supabase/functions/_shared/coach/prompts.ts` |
| Vapi assistants | `vapi/{coach,pulse}-assistant.json` (model/voice) + `scripts/setup-coach-vapi.ts` |
| Demo data | `scripts/seed-coach-demo.ts` |
| Cron (opt-in) | `supabase/scripts/enable_coach_worker.sql` |
| Frontend | `NOVA_FE/components/coach/`, `NOVA_FE/lib/coach-api.ts`, `NOVA_FE/app/coach.css` |
| Tests | `tests/coach.test.ts`, `tests/db/coach_db_test.ts` (`deno task test:db`), `tests/integration/coach_flow.test.ts` |

**Secrets / variables** (all optional; without the Vapi ones phone calls are reported as "not configured" and the browser session still works):

| Name | Kind | Used for |
|---|---|---|
| `VAPI_API_KEY` | secret | outbound follow-up / pulse calls (already used by Setup Vapi) |
| `VAPI_PHONE_NUMBER_ID` | variable | the number outbound calls come from |
| `VAPI_COACH_ASSISTANT_ID`, `VAPI_PULSE_ASSISTANT_ID` | variables | printed by `setup-coach-vapi.ts` |
| `VAPI_COACH_PHONE_NUMBER_ID` | variable | optional: a dedicated inbound number for the coach |
| `OPENAI_ANALYSIS_MODEL` | variable | survey classification and suggestion wording (default `gpt-4o-mini`; uses `OPENAI_API_KEY`) |

**Setup**
1. Merge to `main`: CI applies the migration, runs `deno task test:db`, sets the secrets above and deploys the three functions.
2. Run **Actions → Setup Vapi**; copy the printed assistant ids into the `VAPI_COACH_ASSISTANT_ID` / `VAPI_PULSE_ASSISTANT_ID` variables and redeploy.
3. Seed the demo org (four existing NOVA accounts, one per role):
   ```bash
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... DEMO_EMPLOYEE_PHONE=+3598... DEMO_MANAGER_PHONE=+3598... \
   DEMO_LEADER_PHONE=+3598... DEMO_HR_PHONE=+3598... DEMO_COACH_HISTORY=1 \
     deno run --allow-env --allow-net NOVA_VOICE/scripts/seed-coach-demo.ts
   ```
4. Only when real calls are wanted: run `supabase/scripts/enable_coach_worker.sql` in the SQL editor (stop with `select cron.unschedule('nova-coach-worker')`).

**Demo runbook (≈4 min):** employee → *My voice* → "Answer in browser" (pulse) → *My growth* → "Talk in browser": goal, one step, "share with my manager?" → approve → manager → *My team*: trend dip, top concern "Growth", suggestion → create + publish action; the request appears under "Requests from your team" → reply "Will act" → employee: *My growth* shows the reply, *My voice* shows "You said, we did" → "Demo: a week passed" (phone) → leader → *Insights*: heatmap, Marketing hidden (<5 people), action effect before → after.

| Check (10 October 2026) | Result |
|---|---|
| Unit tests (coach tools, consent sharing, anonymity, analysis, call windows, worker, browser API) | ✅ 16 new, 75 total passing |
| Postgres rules in PGlite (RLS, people-based ≥5 floor, scopes, leases, trend, impact) | ✅ 8 passing (`deno task test:db`) |
| Real Postgres via local Supabase (PostgREST, RLS, RPCs, store + tools) | ✅ `tests/integration/coach_flow.test.ts` |
| Functions served locally; `coach` + `coach-tools` exercised over HTTP; seed run | ✅ |
| FE: typecheck, static build, all coach screens in a browser with seeded data | ✅ |
| Live OpenAI classification / suggestion wording | ⚠️ not run live; keyword fallback and playbook verified |
| Browser voice session (OpenAI Realtime) with coach/pulse tools | ⚠️ not run live (needs `OPENAI_API_KEY`) |
| Outbound Vapi follow-up / pulse calls, deployed coach/pulse assistants | ❌ mocks only |
| Manager email from the employee's Gmail | ❌ mocks only; in-app delivery works |
| Deployed to the shared project | ❌ not yet (branch `feat/coach-plan`) |

## Delegated runtime verification — 10 October 2026

| Check | Result |
|---|---|
| New migrations, three task functions, two Vapi adapters | Applied/deployed to shared Nova; migration dry run is clean |
| Minute scheduler and separate Manus webhook | Enabled; webhook active |
| Immediate, after-call and one-off scheduled research | Completed with real Manus results |
| Duplicate submit / end-call | Same task ID; call release occurs once |
| Connected Gmail email-to-self | One explicitly requested email sent; subsequent Gmail search/read confirmed it |
| Existing Vapi assistant on Zadarma Bulgaria | Six context/task tools and end-of-call routing configured; voice/model settings preserved |
| Active GPT-Live prompts | Speaker and reasoner guidance updated in the actual active fields; date-only questions avoid delegation; model/effort unchanged pending latency comparison |
| Calendar summary repair | Live recovery completed on the original Manus task: 11 Google Calendar events for 12–18 October, summarized in Bulgarian; no provider writes |
| New task suite | 27 tests passed, including Postgres/RLS, provider adapters, Vapi bridge, signatures and uncertain writes |
| Legacy voice suite | 59 tests passed; type checks and lint passed |
| NOVA AI UI | Production build passed; task approval view checked on desktop/mobile with mocked data |
| Actual telephone call review | Three user-reported calls inspected: missing date, wrong empty account, and premature success claim found; account consolidated and live config fixed |
| Phone matching / calendar preparation | Live authenticated Vapi-envelope check passed without PIN/question; event was immediately read back and rejected, with no provider write |
| Calendar/Contacts | Connections consolidated into the named account by explicit owner authorization; provider writes tested with mocks, no real calendar invite sent |
| Places / Outlook live checks | Mocked only; provider credentials still missing |
| Callback / SMS transmission | Handoff implemented; delivery transport remains the voice developer's responsibility |

Legacy `agent_tasks`, webhook and reconcile remain available to finish/review work created before this rollout. The sections below document that legacy flow and its security policy; the delegated-runtime contract above takes precedence for new tasks.

> Repo overview: [../README.md](../README.md). This folder holds the phone assistant's tests, scripts, Vapi configs and docs. Its Edge Functions live in the shared [`../supabase/functions`](../supabase/functions), because Supabase deploys from there.

## Team and ownership

| Area | Who | Where |
|---|---|---|
| Phone assistant: Vapi tools, Manus, task lifecycle, deploy CI | Oleg | `NOVA_VOICE/`, `supabase/functions/{create-task,get-task-status,manus-webhook,reconcile}`, `_shared/{caller,contracts,crypto,db,env,log,manus,tasks,vapi}.ts`, `_shared/email/`, `.github/` |
| NOVA AI backend: auth, OAuth integrations, chat agent, account deletion | Nick | `supabase/functions/{integrations,agent,account-delete}`, `_shared/{http,providers,tools}.ts`, `supabase/README.md` |
| NOVA AI frontend + design | Viktor, Nick | `NOVA_FE/` (Next.js), `Design/` (visual prototype) |
| Legacy Spring backend (reference only) | Viktor | `NOVA_BE/` |

- **One schema, one migration history** in `supabase/migrations`. The DB contract (who owns which table) is in [docs/db-contract.md](docs/db-contract.md).
- **The phone assistant reuses NOVA AI's Gmail code** (`providers.ts`/`tools.ts`) instead of duplicating it.
- Plan and history: [docs/implementation-plan.md](docs/implementation-plan.md).
- NOVA Coach + employee voice (branch `feat/coach-plan`): [plan](docs/coach-mvp-plan.md) and [section above](#nova-coach--employee-voice).

## Legacy status (before delegated runtime rollout)

| Piece | Status |
|---|---|
| Shared schema: NOVA AI tables + `agent_tasks`/`call_sessions`, `activity` mirror trigger, phone lookup, RLS, pg_cron job | ✅ all 5 migrations applied to the shared project (one history via `supabase db push`); verified locally by `NOVA_VOICE/tests/sql/rls.sql` and NOVA AI's `supabase/tests/rls.sql` |
| create-task / manus-webhook / reconcile / get-task-status logic | ✅ 40 unit tests with fakes (`deno task test`) |
| Handlers ↔ real Postgres (phone-verified user, NOVA AI profile context, activity mirror, notification lease) | ✅ integration test against local Supabase (`deno task test:integration`), Manus + Gmail faked |
| Deploy workflow → shared project `vlimtocbrxxnzobhkcoy` | ✅ migrations, secrets, Vault and all 7 functions deployed. Smoke check: `agent`/`integrations`/`account-delete`/`reconcile` → 401 (auth works), `manus-webhook` → 200 |
| `create-task` / `get-task-status` (hosted) | ❌ return 500 until the `TEST_USER_PIN` secret is set (the functions need it at startup) |
| Manus API key, `webhook.list`/`webhook.create` | ✅ real calls; webhook registered and **active** |
| Manus `task.create` / signed webhooks | ✅ **live** (2026-10-10): email summary from a real Gmail → Manus → webhook → `completed` in ~30 s |
| Gmail summary from the caller's own inbox (`_shared/email/prompt.ts`) | ✅ **live**, real Google connection |
| Result email from own Gmail to self (`_shared/email/notify.ts`) | ✅ **live** |
| High-risk flow over the live API: PIN → verification question → read-back → approve → Gmail send | ✅ **live**, task recorded with layers `caller_id,pin,verification,approval`, `approved_via=call` |
| Vapi assistant + phone number | ⚠️ set up by the **Setup Vapi** workflow; needs the `VAPI_API_KEY` secret |
| End-to-end phone call | ❌ not yet |
| Security levels: risk policy, PIN/lockout, verification question (L3, bcrypt), read-back approval by voice or app (L4), reply drafts, double-send protection | ✅ 22 unit tests (`tests/security.test.ts`) + SQL checks; migration `20261010130000` applied to the shared project and merged to `main`; real Gmail sending not yet exercised |
| In-app Approve/Reject + Standard/Secure switch | ⚠️ optional for the MVP (phone approval works without the app); **frontend work**, API in [docs/db-contract.md](docs/db-contract.md#for-the-frontend) |

### Historical rollout steps (superseded by the delegated runtime above)
1. Add the `TEST_USER_PIN` GitHub secret, then re-run the deploy.
2. Sign up in the NOVA AI app with the demo phone number and connect Gmail under Integrations.
3. Run the first real task: curl `create-task` with `tests/fixtures/vapi-create-task.json`, after putting the demo phone and PIN into the fixture. Check that the row goes `submitted → completed`, History updates, and the email arrives.
4. Create the Vapi tools, assistant and phone number from `vapi/`, set a verification question for the demo user (SQL above), then make a real call.
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

## Legacy security levels and access layers (not active in live phone mode)

Every phone request is **assessed for risk**. The risk decides which **verification layers** it needs, and the user's own setting is a floor on top of that. Every decision is recorded on the task (`risk_level`, `layers`).

| Layer | Proves | How (all within the call; no internet, no outbound calls) |
|---|---|---|
| **L1** caller ID | the call comes from the account's number | caller's number = the account's phone. **Prototype:** while SMS verification is paused in NOVA AI, a self-declared `contact_phone` also counts (newest account wins). An SMS-verified phone always wins. |
| **L2** PIN | the caller knows the secret | 6-digit PIN on **every** call (3 wrong = call locked, 10/hour = account locked) |
| **L3** verification question | a second, personal secret | the agent asks the user's **own question** (set in the app). The answer is stored as a bcrypt hash and compared case/space-insensitively. 3 wrong answers lock it for the call. |
| **L4** approval | the owner wants *this exact* action | NOVA AI **reads the action back word for word** on the call, and only an explicit "yes" sends it (`decide_action`). Texts too long to hear in full (>1,500 chars) are approved in the app. **Or in the NOVA AI app** when online (approve, edit or reject). |

| Risk (automatic) | Requests | Standard | Secure |
|---|---|---|---|
| **low** | research (no personal data) | L1 + L2 | L1 + L2 + L3 |
| **medium** | summarize emails (Gmail search on the caller's words), calendar questions, task status | L1 + L2 | L1 + L2 + L3 |
| **high** | reply to an email, send an email, create an event | L1 + L2 + **L3** + **L4** | L1 + L2 + **L3** + **L4** |

- **The level is chosen in the NOVA AI app.** It's stored in `voice_settings.security_level` (`standard` by default, or `secure`). Secure asks the verification question on every call, once per call.
- **No question set → high-risk requests are refused**, never let through. Set the question with `nova_set_my_verification(question, answer)` from the app. For a demo, an admin can run SQL: `select nova_set_verification('<user id>', 'First pet''s name?', 'Rex');`.
- **Dictated email or event:** within the same call. Question → read-back → "Shall I send it?" → yes → sent.
- **Reply draft:** ready a few minutes after the call. Call again and say *"approve my pending email"*. Then PIN → question → read-back → yes → sent. A decision only ever applies to what was read back **on that call**.
- **Nothing that sends or changes data runs without L3 + L4.** The voice side only prepares the action. Its content is validated: one recipient, no header injection, times must carry a timezone. A reply's recipient and subject come from the original email's headers, never from the AI.
- **Approval is consumed before the action runs** (status `sending`), and a provider error is never retried automatically, so an action can't run twice. Unapproved actions expire after 24h.
- Outbound callbacks were prototyped and set aside for the MVP. They're kept on the local branch `archive/callback-approval`.

## Security

- **Vapi → our tools:** an `x-vapi-secret` header or a Vapi *Bearer Token* credential, compared in constant time.
- **Caller identity:**
  - The caller's number has to match an NOVA AI account's **SMS-verified** phone (`auth.users.phone`, via `nova_user_id_by_phone`). Caller ID alone isn't trusted, so the caller must also say a **6-digit PIN** (`TEST_USER_PIN`, one shared PIN for the MVP).
  - Lockout: 3 wrong PINs lock the call, and 10 wrong PINs per user per hour lock that user across all calls.
  - Leave `DEMO_WEBCALL_PHONE` unset outside of testing: it lets anyone with your Vapi public key try PINs through web calls.
- **Gmail/Calendar isolation:**
  - Email and calendar requests read **only the caller's own** Gmail/Calendar, through their NOVA AI Google connection. The emails go to Manus as data, and no Manus Gmail connector is used.
  - Without Gmail connected, the task fails right away with "connect Gmail in the app". There is no fallback to a shared inbox.
- **Result email:** goes from the user's Gmail to that same address only. The recipient is never chosen by the LLM. This system notification to the account owner skips the chat agent's per-send approval, which exists for emails to other people.
- **Manus webhook:** RSA-SHA256 signature over `{timestamp}.{url}.{sha256(body)}`, rejected if older than 5 minutes. Unsigned requests (Manus' registration ping) get a 200 and are ignored.
- **Manus prompts:**
  - research tasks take no actions with external side effects
  - email and web content is treated as untrusted
  - the user's profile notes are sent as context only, capped at 1,500 characters
- **App approval API (`voice-approve`):** the user's NOVA AI session (phone-verified) is required, and only the task's owner can decide on it. Tasks that aren't `awaiting_approval` return 409.
- **Data access:** users can read only their own `agent_tasks` and `activity`, and only their own `voice_settings` (RLS). All writes go through the service role. `call_sessions` is service-only. Deleting an NOVA AI account cascades to all phone-assistant rows.

## Setup

Prerequisites: [Supabase CLI](https://supabase.com/docs/guides/cli), [Deno 2](https://deno.com), Docker (for local). NOVA AI-specific provider setup (Phone Auth, Google/Outlook OAuth, Places, OpenAI) is in [supabase/README.md](../supabase/README.md).

### 1. External accounts
- **Manus:**
  - create an API key (Settings → Developers)
  - check that your plan has credits
  - no Gmail connector is needed, because Gmail comes from the user's NOVA AI connection
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
| `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `GOOGLE_PLACES_API_KEY` | NOVA AI app | see [supabase/README.md](../supabase/README.md) |

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

1. For the current delegated runtime, use all five tool files, including `tool-cancel-task.json` and `tool-respond-to-task.json`, and the assistant end-of-call server routing. For legacy-only setup, create the three tools from `vapi/tool-create-task.json`, `vapi/tool-get-task-status.json` and `vapi/tool-decide-action.json`, replacing `<project-ref>` and `<VAPI_TOOL_SECRET>`. Tools authenticate with an `x-vapi-secret` header; a Vapi Bearer credential works too.


**Automatic (recommended):**
1. Add the Vapi **private** API key as the GitHub secret `VAPI_API_KEY`.
2. Run **Actions → Setup Vapi** (`gh workflow run setup-vapi.yml`). It creates or updates the three tools and the "NOVA AI" assistant, using the right URL and `VAPI_TOOL_SECRET`, and attaches the assistant to your Vapi phone number. Set `VAPI_PHONE_NUMBER_ID` as a variable if you have several numbers. Re-running it is safe.

**Manual alternative:**
1. Create the three tools from `vapi/tool-create-task.json`, `vapi/tool-get-task-status.json` and `vapi/tool-decide-action.json`, replacing `<project-ref>` and `<VAPI_TOOL_SECRET>`. Tools authenticate with an `x-vapi-secret` header; a Vapi Bearer credential works too.

2. Create the assistant from `vapi/assistant.json` and set its `toolIds`.
3. Attach the assistant to the phone number.

## Development

Run these from `NOVA_VOICE/`; `supabase` commands run from the repo root.

```bash
deno task test        # unit tests (no network, fakes for DB/Manus/email)
deno task check       # type-check all functions (ours + NOVA AI's), scripts and tests
deno task lint        # phone-assistant code only
deno task fmt         # phone-assistant code only (NOVA AI's files keep their own style)

supabase start        # local stack (Docker); applies all migrations
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<from `supabase status`> deno task test:integration
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f tests/sql/rls.sql
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f ../supabase/tests/rls.sql
```

## Demo runbook
1. Sign up in the NOVA AI app with your phone number. Connect **Gmail** under Integrations, and optionally fill in your profile.
2. Open **History** in the app.
3. Call the Vapi number from that phone and say: *"Check my recent emails and tell me which ones are important."*
4. NOVA AI asks for the PIN, confirms the task and gives a reference. **Hang up.** The task appears in History as in progress.
5. A few minutes later, the Manus webhook completes it. History (reload) shows it as done with the summary, and the same summary arrives in your Gmail inbox from yourself.

**MVP flow: read → draft → approve → send (no internet needed)**
0. Once: set your verification question in the app (or with the admin SQL above).
1. Call and say: *"Reply to Ivan's last email, tell him I'll be there at 5."* NOVA AI asks for the PIN, then your verification question. Hang up.
2. Manus reads that email (found with a Gmail search in your own inbox) and drafts the reply. The recipient is always the original sender.
3. A few minutes later, call again: *"Approve my pending email."* PIN → question → NOVA AI reads it back: *"A reply to ivan@example.com, subject 'Re: Meeting'. The text reads, quote: … End quote. Shall I send it?"*
4. Say "yes". It's sent from your Gmail, and History shows **Sent**. "No" sends nothing.
5. When you're online you can approve, edit or reject it in the app instead.

**Dictated email (one call):** *"Send an email to ivan@example.com, subject Late, say I'm 10 minutes late."* PIN → question → read-back → "yes" → sent.

**Secure mode:** in the app, set the voice security level to Secure. Every call then asks the verification question (once per call), even for research.

## Legacy limitations / open decisions
- Manus webhook retry semantics aren't documented. Reconcile is the safety net.
- If Manus asks a question (`needs_input`), the user sees it in History and by email, and continues in the Manus UI. There's no voice follow-up yet.
- `create-task` waits for Manus `task.create` (15s client timeout) before answering. The Vapi tool timeout is set to 30s.
- The webhook treats any `stop_reason` other than `ask` as `finish`. Errored tasks are caught by reconcile through `task.detail`.
- Vapi calls themselves (transcript, duration) aren't recorded in History yet. The next step is Vapi's end-of-call report → `activity` with `type = 'call'`.
- The PIN is one shared secret for the MVP. Next step: a per-user PIN, set in the NOVA AI profile and stored hashed.
- Replies go out as a new email with `Re: <subject>` to the original sender. They aren't threaded into the Gmail conversation, because NOVA AI's `send_email` has no `threadId`.
- To change a draft by phone, cancel it and ask again. Editing the text is only possible in the app.
- Prompt injection: email and calendar text goes to Manus as data, with strict instructions to answer only from that data. A Manus agent can still browse, so a malicious email could in theory make it fetch a URL. Profile notes are never included next to that data, and **nothing is sent without L4**.
- **Prototype caller ID:** an unverified `contact_phone` counts as L1 while SMS verification is paused. Remove that branch in `nova_user_id_by_phone` when verification is back.
- No notification when a reply draft is ready, except History. The caller checks with "approve my pending email" or get_task_status.
