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

**What it is.** A personal AI coach that talks to employees by phone (or in the browser) about growth, difficulties and experiences at work, remembers their goals and steps, and calls back to ask how it went. On the same infrastructure, anonymous **pulse check-ins** collect honest feedback by voice, and **managers, leadership and HR** see aggregated, anonymous trends with suggested actions, whose effect is measured in the next check-ins ("You said, we did").

Plan, principles and design decisions: [docs/coach-mvp-plan.md](docs/coach-mvp-plan.md). Schema contract: [docs/db-contract.md](docs/db-contract.md#nova-coach--employee-voice). Status: built on branch `feat/coach-plan`, verified locally and with real phone calls, **not yet deployed** to the shared project.

### Who uses it

| Role | Screen in the app | Gets |
|---|---|---|
| Employee (everyone) | **My growth**, **My voice**, home card | Private coach memory (goals, steps, notes), check-in calls, consent-based requests to the manager, "You said, we did" |
| Manager | **My team** | Their department subtree only: engagement trend, top concerns, 1:1 questions, suggested actions, requests their people chose to share |
| Leadership | **Insights** | Whole org (or own division): department heatmap, attrition risk per team, action effect before/after, campaigns |
| HR | **Insights** | Whole org, campaigns |

Roles come from `org_members.role` (`employee | manager | leader | hr`); the navigation shows only what the role may see.

### Architecture

```
                      ┌────────────── phone ──────────────┐
employee ── calls / is called ──▶ Vapi assistants "NOVA Coach" / "NOVA Pulse"
                                   │ tool-calls (x-vapi-secret, caller number = identity)
                                   ▼
                        coach-tools ─┐
employee ── browser ─▶ coach ────────┤  _shared/coach: store · service (tools) · analysis · prompts
  (live voice via OpenAI Realtime,   │                 insights · delivery · outbound · wiring
   approve shares, call me)          ▼
                       Postgres (RLS)  coach_*  ............ private, owner only
                                       coach_shares ........ manager sees approved ones only
                                       survey_responses .... anonymous (no user_id, no text)
                                       insights_* RPCs ..... aggregates for groups of ≥5 people
manager / leader / HR ── browser ─▶ insights_* RPCs + coach.recommendations (aggregates only)
pg_cron (opt-in) ─▶ coach-worker ─▶ Vapi POST /call  (follow-ups after a step is due, pulse calls)
```

| Piece | Where |
|---|---|
| Migration (tables, RLS, RPCs, triggers, leases) | `supabase/migrations/20261010190000_coach_and_employee_voice.sql` |
| `coach-tools`: 10 Vapi tools (`coach_recall`, `coach_save_goal`, `coach_save_note`, `coach_commit_step`, `coach_record_outcome`, `coach_propose_share`, `coach_decide_share`, `survey_get_questions`, `survey_submit`, `survey_decline`) | `supabase/functions/coach-tools/` |
| `coach`: browser API (`live_session`, `live_tool`, `decide_share`, `call_me`, `followup_now`, `recommendations`) | `supabase/functions/coach/` |
| `coach-worker`: follow-up and pulse calls inside each employee's call hours | `supabase/functions/coach-worker/` |
| Shared logic (DI, tested) | `supabase/functions/_shared/coach/` |
| Prompts + tool schemas (single source for phone and browser) | `supabase/functions/_shared/coach/prompts.ts` |
| Vapi assistants (model/voice) + setup | `vapi/{coach,pulse}-assistant.json`, `scripts/setup-coach-vapi.ts` |
| Frontend | `NOVA_FE/components/coach/`, `NOVA_FE/lib/coach-api.ts`, `NOVA_FE/app/coach.css` (+ role-based nav in `Dashboard.tsx`, optional props in `LiveTalk.tsx`) |
| Demo data | `scripts/seed-coach-demo.ts` |
| Local real-call helpers | `demo/coach-proxy.mjs`, `scripts/coach-local-call.ts` |
| Demo recordings | `demo/record-coach.mjs` (FE walkthrough), `demo/pitch/` (2-minute pitch video) |
| Cron (opt-in) | `supabase/scripts/enable_coach_worker.sql` |

### Privacy model (enforced in the database, covered by tests)

- **Coach memory is private.** `coach_goals/notes/steps` are readable only by the owner; managers, leadership and HR have no path to them. Follow-up columns can't be written from the browser.
- **Consent-based sharing.** The coach drafts a request; it reaches the manager only after an explicit yes to the exact text, and only from the same call that read it back (or in the app). The recipient comes from `org_members.manager_user_id` / `coach_profiles.manager_email`, never from the model.
- **Anonymous surveys.** `survey_responses` has no `user_id`, day granularity only, closed theme lists, and no browser access. Free text is reduced to themes and discarded.
- **People-based floor.** Every aggregate needs a team of ≥5 members **and** a check-in answered by ≥5 people; 4 people answering weekly stay hidden.
- **Text, never voice.** Sentiment comes from the words only (no emotion recognition from voice, EU AI Act Art. 5(1)(f)). No individual attrition score; `manager_support` appears only after 2+ campaigns.
- **Not therapy.** Crisis signals stop the coaching and point to professional help.

### Run it locally (full demo, no hosted services needed)

Prerequisites: Docker, Supabase CLI, Deno 2, Node 20+.

```bash
# 1. Database + functions
supabase start
supabase migration up --local --include-all          # or: supabase db reset (wipes local data)
printf 'VAPI_TOOL_SECRET=%s\nCRON_SECRET=local-cron\nVAPI_TASK_SERVICE_SECRET=local-task\n' "$(openssl rand -hex 32)" > /tmp/coach.env
# optional: OPENAI_API_KEY=... (live sentiment, suggestion wording, "Talk in browser")
supabase functions serve --env-file /tmp/coach.env

# 2. Frontend (another terminal)
cd NOVA_FE && npm install
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(supabase status -o env | grep '^ANON_KEY=' | cut -d= -f2- | tr -d '"')" \
  npx next dev -p 3100

# 3. Demo org: sign up four accounts in the app (one phone number per role), then
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY="$(supabase status -o env | grep '^SERVICE_ROLE_KEY=' | cut -d= -f2- | tr -d '"')"
DEMO_EMPLOYEE_PHONE=+3598... DEMO_MANAGER_PHONE=+3598... DEMO_LEADER_PHONE=+3598... DEMO_HR_PHONE=+3598... \
DEMO_MANAGER_NAME=Alex DEMO_COACH_HISTORY=1 \
  deno run --allow-env --allow-net=127.0.0.1 NOVA_VOICE/scripts/seed-coach-demo.ts
```

The seed creates "Northwind (demo)": Sales, Engineering, Customer Success and Marketing (4 people, hidden on purpose), about 30 synthetic employees, 8 weeks of anonymous pulse answers (Sales dips, an action is published, Sales recovers), an open pulse for this week, and, with `DEMO_COACH_HISTORY=1`, a goal + open step for the employee. Re-running replaces the demo org. Open `http://localhost:3100` and log in with each phone number to see each role.

### Real phone calls from a local stack

Vapi must reach `coach-tools` over the internet. Expose **only** that endpoint:

```bash
node demo/coach-proxy.mjs                              # 127.0.0.1:8787, everything else → 404
cloudflared tunnel --url http://127.0.0.1:8787         # prints https://<random>.trycloudflare.com
# Create/update the two assistants in Vapi, pointing at the tunnel (VAPI_TOOL_SECRET = the one in /tmp/coach.env)
VAPI_API_KEY=... VAPI_TOOL_SECRET=... COACH_TOOLS_URL=https://<random>.trycloudflare.com/functions/v1/coach-tools \
  deno run --allow-env --allow-read --allow-net=api.vapi.ai NOVA_VOICE/scripts/setup-coach-vapi.ts
# Restart `supabase functions serve` with these added to the env file:
#   VAPI_API_KEY, VAPI_PHONE_NUMBER_ID (GET https://api.vapi.ai/phone-number), VAPI_COACH_ASSISTANT_ID, VAPI_PULSE_ASSISTANT_ID
# Place a call to the demo employee's phone:
deno run --allow-env --allow-net=127.0.0.1 NOVA_VOICE/scripts/coach-local-call.ts +3598XXXXXXXX followup_now   # "a week passed"
deno run --allow-env --allow-net=127.0.0.1 NOVA_VOICE/scripts/coach-local-call.ts +3598XXXXXXXX call_me pulse  # pulse check-in
```

The same actions are buttons in the app: **Call me now** / **Demo: a week passed** (My growth) and **Call me** (My voice). Calls go out from the Vapi number; the inbound assistant of that number is not changed. The trycloudflare URL changes on every start, so re-run `setup-coach-vapi.ts` after restarting the tunnel.

Suggested lines for a live demo: the coach opens with *"Last time you planned to prepare one proposal… Did you get to it?"* → "Partly, I prepared it but didn't present it; I got nervous when my manager was in the room" → "Send it to my manager before the meeting" → "I'll email it by Wednesday" → "Yes, tell my manager I'd like a small project". For the pulse: "3, same kind of tasks every week" → "4, my manager listens" → "Too many meetings".

### Deploy to the shared project

1. Merge `feat/coach-plan` into `main`. CI runs `deno task test` and `deno task test:db`, applies the migration, sets secrets and deploys `coach`, `coach-tools`, `coach-worker`.
2. Add the GitHub secret `VAPI_API_KEY`, run **Actions → Setup Vapi**, and store the printed ids as the variables `VAPI_COACH_ASSISTANT_ID` / `VAPI_PULSE_ASSISTANT_ID` (plus `VAPI_PHONE_NUMBER_ID`), then redeploy.
3. Seed a demo org against the hosted project with the seed command above (hosted `SUPABASE_URL` and service key).
4. Only when automatic calls are wanted, run `supabase/scripts/enable_coach_worker.sql` in the SQL editor (stop: `select cron.unschedule('nova-coach-worker')`).

| Secret / variable | Kind | Used for |
|---|---|---|
| `VAPI_API_KEY` | secret | outbound follow-up / pulse calls, Setup Vapi |
| `VAPI_PHONE_NUMBER_ID` | variable | the number outbound calls come from |
| `VAPI_COACH_ASSISTANT_ID`, `VAPI_PULSE_ASSISTANT_ID` | variables | printed by `setup-coach-vapi.ts` |
| `VAPI_COACH_PHONE_NUMBER_ID` | variable | optional dedicated inbound number for the coach |
| `OPENAI_API_KEY` (existing), `OPENAI_ANALYSIS_MODEL` | secret / variable | sentiment + themes, suggestion wording (default `gpt-4o-mini`), browser voice |

Without the Vapi values, call buttons answer "Phone calls are not configured yet" and everything else works; without OpenAI, a keyword classifier and a rules playbook are used.

### Demo videos

- **FE walkthrough** (2:15, against the local seeded stack, external requests blocked): `node demo/record-coach.mjs` with the env described in its header. Output in `demo/output/coach-*/`.
- **2-minute pitch video** (real coach + pulse call recordings, phone screen recording, FE clips, subtitles, zooms): `demo/pitch/render.sh` with `COACH_WAV`, `PULSE_WAV`, `PHONE_MP4`, `FE_MP4` (the call recordings are downloaded from the Vapi dashboard). `build.py` holds the edit (segments, subtitles, audio), `page.html` the visuals; frames are rendered deterministically and muxed with ffmpeg.

### Tests

```bash
cd NOVA_VOICE
deno task test          # unit tests (coach tools, consent sharing, anonymity, analysis, call windows, worker, browser API)
deno task test:db       # Postgres rules in PGlite: RLS, people-based floor, scopes, leases, trend, impact
deno task check && deno task lint
SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... deno task test:integration
cd ../NOVA_FE && npm run typecheck && npm run build
```

### Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Phone calls are not configured yet" | `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID` or the assistant ids are missing in the functions' env |
| The coach says the number isn't linked | The caller's number isn't a NOVA account (`account_phones`); browser/web calls are never trusted for identity |
| A team shows "Fewer than 5 people answered. Hidden." | Expected: the anonymity floor. Seed more members/answers |
| `supabase migration up` complains about order | The local DB is behind; use `--include-all` (or `supabase db reset`, which wipes local data) |
| Vapi tool calls fail after restarting the tunnel | The trycloudflare URL changed; re-run `setup-coach-vapi.ts` with the new `COACH_TOOLS_URL` |
| Sentiment looks too harsh | No `OPENAI_API_KEY`: the keyword fallback is coarse on mixed answers |

### Verification status (10 October 2026)

| Check | Result |
|---|---|
| Unit tests | ✅ 75 passing (16 for the coach) |
| Postgres rules in PGlite | ✅ 8 passing (`deno task test:db`) |
| Real Postgres via local Supabase (PostgREST, RLS, RPCs, store + tools) | ✅ `tests/integration/coach_flow.test.ts` |
| Functions served locally, API over HTTP, seed | ✅ |
| FE: typecheck, static build, all coach screens with seeded data | ✅ |
| **Coach follow-up call to a real Bulgarian mobile** (Zadarma number, local stack via tunnel) | ✅ live: greeted with the due step, coached, saved a new step. Found and fixed in the prompt: record the old step's outcome first, offer a share before closing |
| **Pulse check-in call** | ✅ live: questions + "why", `survey_submit`, anonymous row (scores + themes, no text/user), invite → answered |
| Live OpenAI classification / suggestion wording, browser voice session | ⚠️ not run live (no `OPENAI_API_KEY` locally); keyword fallback (improved from the live call) and playbook verified |
| Manager email from the employee's Gmail | ❌ mocks only; in-app delivery works |
| Deployed to the shared project | ❌ not yet (branch `feat/coach-plan`) |
| `NOVA_VOICE/tests/sql/rls.sql` | ❌ pre-existing failure unrelated to the coach: it inserts two users with the same contact phone, which `20261010175000_unique_phone_accounts.sql` now forbids |

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
| NOVA Coach + employee voice: migration, `coach`/`coach-tools`/`coach-worker`, `_shared/coach/`, Vapi coach/pulse assistants, demo tooling | Oleg | `supabase/migrations/20261010190000_*`, `supabase/functions/{coach,coach-tools,coach-worker}`, `_shared/coach/`, `NOVA_VOICE/`, `demo/` (FE screens in `NOVA_FE/components/coach/`: review with Viktor/Nick) |
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
