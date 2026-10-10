# NOVA Coach: MVP plan (hackathon)

Status: **implemented on branch `feat/coach-plan`** (backend, database, frontend, tests, Vapi setup and demo seed). What is verified and what still needs a live run is in the [README](../README.md#nova-coach--employee-voice).

## Idea
An AI that talks to employees by phone (or in the browser), with two modes on one infrastructure:

1. **Personal coach.** Conversations about growth, difficulties and experiences at work. The value is for the employee first. The company sees only what the employee explicitly approves.
2. **Employee voice.** Anonymous voice engagement surveys and short pulse checks. The AI analyses the *language* of the answers (sentiment and themes), and **managers, leadership and HR** see aggregated trends by team and department, team-level attrition-risk indicators and suggested actions. Each role sees its own scope (see "Who gets what").

**The message that ties them together:** employees should feel that they matter to the company and that their wellbeing, motivation and growth are essential. Every piece of feedback therefore ends with a visible result for the employee: "You said, we did", a personal follow-up call, progress they can see themselves.

**Demo scenario (one complete loop):**
1. Pulse check-in (2 min): "How was your week? What got in your way?" → anonymous answer.
2. Sales manager's dashboard: engagement dropping, theme "same tasks, no growth", suggestion "project rotation + growth 1:1s" → the manager creates an action.
3. Coach conversation: "I want to grow but don't know the next step" → one small step + an approved request to the manager ("I'd like to take on a small project").
4. Follow-up call from the AI: "Did you present it? How did your colleagues react?"
5. Closing the loop: the employee sees "You said, we did" (the team started project rotation) and that their voice had an effect.
6. Leadership dashboard: the next pulses show Sales recovering after the action. The effect of the decision is measured.

**Success criterion:** the employee looks forward to the next conversation, and management and HR get a concrete action whose effect they can measure, not just a number.

## Who gets what
| Role | Value | What they see |
|---|---|---|
| **Employee** | Growth, support, a sense that their voice has an effect | Their own goals, steps and shares; "You said, we did" for their department |
| **Team manager** | Knows what's in the team's way before it becomes a problem; concrete 1:1 topics; who wants more responsibility (only with consent) | Aggregates for their own department subtree (≥5 people), approved requests from their people, their actions |
| **Leadership** (CEO, directors) | Where engagement drops, where attrition risk is, and whether changes (reorg, new policy, training) actually help | Aggregates for the whole org or their division, before/after effect of actions |
| **HR** | Development and retention programmes, campaigns, measuring results | Aggregates for the org, managing campaigns |

Management gets a tool for acting, not just a report: every trend leads to a suggestion, every suggestion to an action with an owner, and every action is measured in the next pulse.

## Principles (non-negotiable)
1. **Coach conversations are private by default.** Nothing reaches the company without explicit approval of the exact text (same model as exact-action approval).
2. **Surveys are anonymous to the company.** Responses are stored without `user_id`, only with day granularity, and without free text. Management and HR only see groups backed by **at least 5 people**: the team has ≥5 members *and* at least one check-in in the period was answered by ≥5 people (each person answers a check-in once). Counting answers alone would let 4 people who answer weekly pass the floor; the tests cover this. Free text is reduced to themes from a closed list and discarded. Honest caveat: during the call the system knows who is calling (authentication), but that link is not stored with the answer. Only a separate "answered campaign X" record is kept, so we don't ask twice. The UI says "anonymous to your company", not "fully anonymous".
3. **Coaching and surveys never mix.** Coach notes never enter management/HR analytics. Sentiment and risk come only from survey answers.
4. **No individual attrition risk.** Attrition indicators exist only per team/department. An individual risk score would destroy trust and is profiling under GDPR.
4a. **A development signal, not a performance rating.** The data is not used to rate individuals. The `manager_support` theme per team helps leadership support managers (training, load) but is not a KPI for bonuses or sanctions, and it only appears after ≥2 campaigns so nobody reacts to one-off noise.
5. **Sentiment from text, never from voice.** Only the words of the transcript are analysed. Emotion recognition from voice (biometrics) at work is prohibited by the EU AI Act (Art. 5(1)(f), in force since 02/2025). No audio is stored; the text is discarded after extracting scores and themes.
6. **The LLM never chooses a recipient.** The manager comes from `org_members.manager_user_id` (set by the org) or `coach_profiles.manager_email` (set by the employee in the app).
7. **The company gets actions, not transcripts.**
8. **Not therapy.** On signs of crisis the AI stops coaching, says so openly and points to professional help (112 in the EU, a crisis line, a doctor, a trusted person). It never diagnoses.
9. **The employee controls their memory.** They see, edit and delete goals, steps and notes.
10. Logs go through `_shared/log.ts` and never contain conversation content.

> Legal note: AI used to evaluate or monitor employees falls into the EU AI Act high-risk category (Annex III, point 4). For the hackathon we mention it and show the safeguards (aggregates, ≥5 people, no biometrics, no individual risk). A real product needs legal review and a DPIA.

## What we reused
| Need | Existing |
|---|---|
| Phone + identifying the employee | Vapi + authenticated caller-number matching (`nova_user_id_by_phone`, `authenticateCaller`, `call_sessions`) |
| Browser voice (demo fallback, no phone needed) | `LiveTalk` (OpenAI Realtime over WebRTC), extended with optional session/tool props |
| Outbound calls | Vapi client restored from the archived prototype on `archive/callback-approval` |
| Share approval | Conditional transitions (`draft → approved`) bound to the call that read the draft back |
| Email to the manager | Lease → send → mark, from the employee's own Gmail (Alo `tools.ts`) |
| Cron | Same Vault secrets as the reconcile job (`project_url`, `cron_secret`) |
| FE shell, navigation | `Dashboard.tsx` (`DashView`), the existing card/button styles |

## What was built

### 1. Database: `supabase/migrations/20261010190000_coach_and_employee_voice.sql`
- **Org and roles:** `orgs`, `departments` (tree), `org_members` (`employee | manager | leader | hr`, manager link). No browser access; the app reads its own membership via `coach_my_membership()`.
- **Coach (private):** `coach_profiles` (manager, call hours, opt-outs), `coach_goals`, `coach_notes`, `coach_steps` (a due date schedules the follow-up via trigger; closing the step cancels it; follow-up columns have no browser grant), `coach_shares` (draft → approved/rejected → sent; the manager reads only approved ones and replies via `coach_share_respond`; `coach_team_requests()` adds the employee's name).
- **Surveys (anonymous):** `survey_campaigns`, `survey_invites` (whether, never what), `survey_responses` (no `user_id`, no browser grant, closed theme lists enforced by CHECK), `action_items` ("You said, we did").
- **Insights (aggregates only):** `insights_departments`, `insights_trend` (one point per check-in week), `insights_action_impact` (before/after), all with the people-based floor; `insights_launch_campaign` (managers: pulse for their own subtree only), `insights_close_campaign`, `insights_save_action` (managers: own team; org-wide needs leader/HR).
- **Worker leases:** `coach_claim_followups`, `survey_claim_invites` (10-minute lease, `skip locked`); `survey_record_response` writes the answer and marks the invite in one transaction.

### 2. Edge Functions (each `handler.ts` + `index.ts`)
| Function | Caller | What it does |
|---|---|---|
| `coach-tools` | Vapi (coach + pulse assistants) | 10 tools: `coach_recall`, `coach_save_goal`, `coach_save_note`, `coach_commit_step`, `coach_record_outcome`, `coach_propose_share`, `coach_decide_share`, `survey_get_questions`, `survey_submit`, `survey_decline`. User = authenticated caller number. |
| `coach` | Signed-in browser user | `live_session` (Realtime token with coach/pulse instructions + tools; coach context preloaded), `live_tool`, `decide_share`, `call_me`, `followup_now` (demo: "a week passed"), `recommendations` (from the caller's own aggregates, via their JWT) |
| `coach-worker` | pg_cron (opt-in) | Places due follow-up and pulse calls inside each employee's call window; retries once, then gives up; respects opt-outs |

Shared code: `supabase/functions/_shared/coach/` (`store`, `service`, `analysis`, `prompts`, `insights`, `delivery`, `outbound`, `wiring`).

### 3. Analysis
- `analysis.ts`: OpenAI JSON-schema classification with enums (sentiment, concerns, strengths, attrition signals); anything outside the closed lists is dropped. Keyword fallback (EN/BG) if the model is unavailable.
- Engagement index = 70% scores + 30% language, so "4 out of 5, said in exhausted words" lands lower than a plain 4. The UI shows both ("Scores say / Words say").
- Suggested actions (`insights.ts`): a rules playbook picks the top concern per team (≥30% share, ranked by share, drop and attrition), and the LLM only rewrites the wording. Inputs are aggregates only.

### 4. Prompts (`_shared/coach/prompts.ts`, the single source)
- **Coach** (English): recall → open question → concrete situation → what was tried → **one** small step phrased by the employee → due date → summary → sharing only if wanted, with an explicit "your manager sees only this sentence". More questions than advice, short turns, crisis boundary.
- **Pulse:** says it takes 2 minutes and is anonymous, asks the questions one at a time with one "why?", avoids identifying follow-ups, reads back numbers only, thanks and tells what the company already changed.
- `NOVA_VOICE/scripts/setup-coach-vapi.ts` creates/updates both Vapi assistants and their tools from this file (also run by the **Setup Vapi** workflow).

### 5. Frontend (`NOVA_FE`)
| View | Who | Contents |
|---|---|---|
| Home card | everyone | "Your step this week" + next check-in, "Your voice is wanted" / latest "You said, we did" |
| **My growth** | everyone | Talk in browser / Call me, next step (record outcome, demo "a week passed"), progress timeline, goals, shared with your company (approve/discard drafts, manager replies, "Stays private"), what NOVA remembers (delete), coach settings |
| **My voice** | org members | Open check-in (answer in browser / call me), "You said, we did", how anonymity works |
| **My team** | managers | KPI tiles, weekly trend, "Beyond the scores", top concerns, 1:1 questions, suggested actions, actions with before/after effect, requests from the team (reply: seen / will act / done), launch pulse |
| **Insights** | leadership, HR | Department filter, KPI tiles, trend, concerns, heatmap departments × themes with risk, suggested actions, actions and effect, campaigns |

The app now defaults to English. Groups below the floor show "Fewer than 5 people answered. Hidden.", never zero.

## Verification done
- `deno task test`: 75 unit tests (16 new for coach: tool auth, idempotency, consent sharing bound to the call, delivery lease, anonymous submit, analysis, call windows, worker retries/opt-outs, browser API).
- `deno task test:db`: 8 PGlite tests (RLS, people-based floor, scopes, manager_support rule, campaigns/actions rules, leases, trend, impact).
- `tests/integration/coach_flow.test.ts` against local Supabase (PostgREST + RLS + RPCs).
- Local stack: migration applied, functions served, API exercised over HTTP, seed run, all four screens checked in a real browser.
- `npm run typecheck` and `npm run build` (static export) pass.
- **Real phone calls** (10 Oct, local stack exposed through a tunnel that allows only `coach-tools`): a coach follow-up call and a pulse check-in to a real Bulgarian mobile from the Zadarma number. The coach recalled the due step, coached and saved a new step; the pulse stored an anonymous row and marked the invite answered. Fixes from those calls: the coach now records the old step's outcome first and offers a share before closing; the keyword fallback handles mixed answers better.
- **Demo material:** FE walkthrough recording (`demo/record-coach.mjs`) and a 2-minute pitch video built from the real calls (`demo/pitch/`).

## Still open / not verified live
- **Hosted deployment** of the coach functions and the Vapi assistants pointing at the shared project (verified so far only against the local stack through a tunnel).
- **OpenAI classification and recommendation wording** live: verified with the keyword fallback and playbook only.
- **Email to the manager** from Gmail: mocked; the in-app delivery works without it.
- Deployment to the shared project happens when this branch is merged into `main` (CI applies the migration). The cron worker is enabled only by running `supabase/scripts/enable_coach_worker.sql`.

## Risks
- **Phone reliability on stage** (network, caller ID shown as a US number by the carrier). Fallback: the recorded pitch video, or the browser session.
- **Trust and anonymity.** If the jury or employees sense surveillance, the idea fails. Hence the people-based floor, no verbatim quotes, no individual risk, the "Stays private" box and the honest wording.
- **Small departments.** The floor hides them (Marketing in the seed shows this on purpose).
- **Legal.** EU AI Act (no emotion recognition from voice at work; high-risk for employment decisions), GDPR profiling. Mitigated by principles 2–5.
- **Coaching quality by phone:** latency, long turns. Short turns in the prompt, manual test calls.
- **FE ownership.** `NOVA_FE` belongs to Nick and Viktor: the changes are additive (new `components/coach/`, `app/coach.css`, `lib/coach-api.ts`) plus small edits to `AloApp`, `Dashboard`, `HomeOverview`, `LiveTalk`, `Icon`, `layout` and the default language. Review with them before merging.

## Open questions
1. Engagement index: own index (scores + language) or a standard model? Current choice: pulse = 3 questions; engagement survey = eNPS + 3 scale questions + 1 open.
2. Should action impact stay before/after (a correlation, labelled as such) or compare with control teams?
3. Who plays which role in the demo? The seed needs four separate NOVA accounts (employee, manager, leader, optional HR).
