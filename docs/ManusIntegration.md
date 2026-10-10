# Delegated tasks: Alo → Manus

Alo persists and authorizes tasks; Manus researches and reasons. Provider credentials stay in Alo. New work uses `alo_tasks` and the minute worker. Existing `agent_tasks` continue through the old worker until drained; never copy running legacy tasks into the new queue.

## Vapi handoff

The existing `create-task` and `get-task-status` URLs now adapt the existing Vapi tool protocol to the durable queue. They retain caller PIN and verification-question checks from NOVA_VOICE. `create_task` returns immediately after persistence. It accepts `start_mode` (`now`, `after_call`, `scheduled`), `run_at` (ISO time with offset), `timezone` (default Europe/Sofia), and `delivery_channels` (`email`, `callback`, `sms`; default none). No transcript-derived tasks are created.

Update the tool definitions in `NOVA_VOICE/vapi/` and set the assistant's server URL to `/functions/v1/create-task`, using a configured `x-vapi-secret` header. Include `end-of-call-report` in `serverMessages`. That authenticated event releases the verified call's after-call tasks. Repeated reports are harmless. Configure `cancel_task` and `respond_to_task` from the supplied definitions. Existing tool names remain valid.

`decide_action` reads the exact persisted proposal back, binds the call to its task revision, and approves only that proposal on the following explicit response. New tasks do not inherit approval from model-supplied fields. Long actions must be reviewed in the app. An approval queues execution; it does not claim the action has succeeded. Legacy approvals continue through their previous path.

Caller verification remains the Vapi developer's existing phone lookup plus PIN and verification-question policy. The current prototype lookup also accepts profile `contact_phone` while SMS is paused; this adapter does not change it. A task still requires a server-verified call session, never a phone number supplied as task authorization.

## Direct backend contract

POST JSON to `/functions/v1/tasks`.

- Browser: `Authorization: Bearer <Supabase access token>`; user resolved with `getUser`.
- Trusted voice backend: `Authorization: Bearer <VAPI_TASK_SERVICE_SECRET>` AND `call_id` referencing `call_sessions` with a user and `verified_at` within 24 hours. Only the trusted voice backend creates verified sessions. Phone numbers and submitted `user_id` are never authority.
- `call_activity_id`, if supplied, must reference that same owner's History call.
- No credentials belong in the instruction, tool arguments, logs, or responses.

Submit:

```json
{
  "action": "submit",
  "call_id": "verified-vapi-call-id",
  "request_id": "stable-unique-request-id",
  "instruction": "Research accessible parks in Sofia and save a short comparison.",
  "start_mode": "scheduled",
  "run_at": "2026-10-30T10:00:00+02:00",
  "timezone": "Europe/Sofia",
  "grants": [],
  "delivery_channels": []
}
```

Returns HTTP 202 with `{task, acknowledgement}`. Acknowledgement is `saved`, `scheduled`, or `running`; `saved` includes queued and waiting-for-call-end states. Reusing the same request ID and payload returns the same task; a changed payload conflicts. `run_at` is stored in UTC alongside the original IANA timezone. Ambiguous local times must be clarified upstream; the API requires an explicit offset. Scheduling is a start condition, not a completion promise. Only one-off schedules are supported.

Other operations:

```json
{"action":"end_call","call_id":"verified-vapi-call-id"}
{"action":"get","call_id":"verified-vapi-call-id","task_id":"uuid"}
{"action":"respond","call_id":"verified-vapi-call-id","task_id":"uuid","revision":4,"answer":"Use the second address."}
{"action":"approve","call_id":"verified-vapi-call-id","task_id":"uuid","revision":4}
{"action":"cancel","call_id":"verified-vapi-call-id","task_id":"uuid"}
```

Browsers omit `call_id` and cannot end calls or impersonate voice sessions. `get` returns state/result/clarification/error and separate delivery statuses. Approvals require the current revision and exact stored proposal; the client cannot substitute arguments. Responding cannot grant new permissions. An uncertain external action requires operator reconciliation, not a retry button.

## Delegated permission

The trusted backend can store a bounded user authorization in `grants`. Each grant is single-use. Only subject/body (email) or title/description (calendar) can be generated; recipients, guests and times are fixed. Example for an explicitly requested email:

```json
{
  "tool":"send_email",
  "constraints":{"to":"maria@example.com"},
  "generated_fields":["subject","body"]
}
```

Extra recipients/fields, changed constraints, Outlook writes, unknown tools and reused permissions are rejected or require a new approval. The Vapi adapter deliberately uses its existing stronger readback policy: it initially supplies no grants and waits for exact-action approval. Manus decisions never grant permission and are not provider success receipts.

Supported tools:

| Service | Tools |
|---|---|
| Gmail | `list_recent_emails`, `search_emails`, `get_email`, `create_email_draft`, `send_email` |
| Contacts | `search_contacts` |
| Calendar | `list_calendar_events`, `create_calendar_event` |
| Places | `search_places` |
| Outlook | `read_outlook_mail`, `read_outlook_calendar`, `search_outlook_contacts` |

Arguments are allowlisted and bounded in `delegation/validation.ts`. Existing OAuth refresh/access code is reused. Connections are checked each worker turn and immediately before provider calls. Scheduled work therefore cannot silently use disconnected services. Missing/expired connections pause the task. Places needs `GOOGLE_PLACES_API_KEY`; Outlook needs Microsoft client credentials and an Alo connection.

## Worker and recovery

`task-worker` is authenticated by `TASK_WORKER_SECRET`. Each invocation claims one ready task with `FOR UPDATE SKIP LOCKED` and a 120-second database lease, processes one durable phase, then handles one requested email delivery. Overlapping invocations claim different tasks. Provider requests have timeouts below the lease. Lost/expired leases cannot commit steps or advance tasks.

Phases: create Manus task → poll/reconcile → execute one validated tool → feed receipt into the **same** Manus task. Structured output is rearmed on each continuation. Eight tool rounds per user clarification are allowed; then the task needs input. Manus receives profile context and bounded read results, never provider tokens or Supabase credentials. Its native account connectors are disabled.

External writes are journalled before sending. On restart, successful receipts are reused. A started write without a receipt becomes `needs_input / uncertain`, never a blind resend. Ambiguous Manus creation is reconciled by the unique `#alo:<task UUID>` title marker; continuation uses a unique turn marker. If recovery cannot prove what happened, execution pauses. Transient failures retry up to three attempts with backoff. Cancellation blocks further steps and requests Manus termination, but cannot undo an in-flight/completed email or event.

`task-webhook` verifies Manus RSA signatures against the exact configured public URL and timestamp (five-minute window). Event IDs are unique. Webhooks only wake the worker; task polling recovers missed notifications. Unsigned activation probes return 200 without touching state.

## Delivery handoff

Results always remain in History. An email request sends the result to the connected Gmail account's own address, resolved by the backend. It never uses a model-selected notification recipient.

The Vapi delivery worker uses the service secret (no call session required for claim/ack):

```json
{"action":"claim_delivery","channel":"callback"}
{"action":"ack_delivery","delivery_id":"uuid","lease_id":"uuid","status":"sent"}
```

Channels are `callback` and `sms`; acknowledgements are `sent`, `failed`, or `uncertain`. Claims include `task_id`, `user_id`, a five-minute `lease_id`, and generic notification text. Resolve the verified destination server-side. Authenticate the recipient before revealing private content. Do not read raw task results into an unauthenticated outbound call or SMS. Expired claims become uncertain rather than being redelivered automatically. Duplicate/late acknowledgements conflict. A failed notification never reruns execution.

Actual callback/SMS placement remains the Vapi delivery developer's responsibility. These durable handoffs do not claim a phone call or SMS was sent.

## Manual deployment

Branch pushes run tests only. The existing deployment workflow is now restricted to `main` (or manual dispatch). Deploying the branch manually was explicitly approved for shared Nova.

1. Review and apply the additive `20261010112556` and `20261010114220` migrations. On the shared project they were applied individually, then marked applied with `supabase migration repair`; don't replay them. Use `supabase db push --dry-run` before future migrations.
2. Set `MANUS_API_KEY`, `VAPI_TASK_SERVICE_SECRET`, `TASK_WORKER_SECRET`, `TASK_WEBHOOK_URL`, optional `VAPI_DELEGATION_SECRET`, and existing integration/auth secrets in Edge Function Secrets. Keep task secrets distinct from the Vapi public-facing tool credential. `TASK_WEBHOOK_URL` must exactly match the registered URL.
3. Deploy `tasks task-worker task-webhook create-task get-task-status` using `supabase functions deploy ... --use-api`. Existing legacy functions remain for old tasks.
4. POST `{"action":"register_webhook"}` to `task-worker` with the worker secret; this idempotently registers the separate Manus webhook without exposing the API key.
5. Set Vault names `alo_task_project_url` and `alo_task_worker_secret`, then explicitly run `supabase/scripts/enable_task_scheduler.sql`. This minute schedule is deliberately not enabled by a migration. Task secrets are not rotated by the legacy CI deployment. The live Alo assistant uses the separate `VAPI_DELEGATION_SECRET`; the adapter also accepts the original `VAPI_TOOL_SECRET` so other existing clients keep working.
6. Update Vapi tool schemas and assistant call-ended routing; keep its voice/model configuration and caller verification intact.
7. Run controlled tests with a verified-call fixture and designated integration account. Do not point a production fixture at an unrelated user's data.

Rollback: pause `alo-delegated-task-worker` in Cron, stop new submissions at the voice adapter, retain task tables and journals for reconciliation. Do not reset uncertain writes or delete pending deliveries as a shortcut. Legacy queue and cron remain separate.

## Validation

```sh
npx deno test --allow-read --allow-env --allow-sys --config supabase/functions/deno.json supabase/tests/delegation
cd NOVA_VOICE && npx deno task test && npx deno task check && npx deno task lint
cd ../NOVA_FE && npm run build
```

The delegated suite runs real Postgres migration/RLS/lease checks in PGlite plus mocked provider/Manus/Vapi boundary tests. It covers duplicate requests/end-call events, isolation, schedules/DST day boundaries, concurrent claims, crash recovery, exact approvals, cancellation, uncertain writes, all integration adapters, signatures, and delivery deduplication. Live verification status is recorded in `NOVA_VOICE/README.md`; passing mocks is not live provider verification.
