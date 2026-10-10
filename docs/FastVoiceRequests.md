# Direct voice requests and explicit Manus delegation

Alo uses synchronous Vapi tools for everyday integration requests. Manus is used only when the caller explicitly asks to delegate work or run it in the background. Complexity, provider failure and latency are never delegation triggers.

## Contract

All requests use the existing Vapi `message.type = tool-calls` envelope and trusted `message.call` with the configured server secret. Ownership is resolved from the telephone call on every request. Model-supplied account IDs, phone numbers and browser call identities cannot select an account. Phone mode does not ask for a PIN or a security answer.

`POST /functions/v1/voice-tools` returns HTTP 200 and one string `result` or `error` per `toolCallId`.

- Reads: `get_latest_email`, `get_email`, `search_emails`, `list_recent_emails`, `list_calendar_events`, `search_contacts`, `search_places`, `read_outlook_mail`, `read_outlook_calendar`, `search_outlook_contacts`.
- `get_latest_email` reads the newest **Inbox** message without a time cutoff. MIME plain text is preferred; HTML-only messages are converted to text without loading remote resources or attached documents. The speaker may read requested content aloud.
- Read results include operation, requested arguments, retrieval time, timezone, compact data and a truncation flag. Email bodies are limited to 10,000 characters in the voice result; a snippet is never represented as the complete email. Ambiguous contact matches remain separate.
- `prepare_action` accepts `intent: send_email | create_calendar_event`, the exact details, instruction, start mode, optional schedule/timezone and delivery preferences. It persists a direct task and binds its read-back revision to the call. It performs no external write.
- `decide_action` without a decision reads the pending proposal. After explicit approval, `decision: approve` atomically approves and claims immediately due direct actions. `reject` cancels the reviewed task. The response distinguishes completed, running, scheduled, waiting_call and needs_input; only a confirmed provider receipt permits completion.
- `create_task` requires `delegation_requested: true` and `delegation_request` containing the caller's stated delegation. These are persisted in `state.delegation`. This is a model attestation backed by prompt rules, not an independent proof of what the caller said. Audit the call transcript when reviewing routing.
- Existing task status, clarification, cancellation, end-call release and delivery remain available at the existing URLs. Legacy task readbacks retain their legacy handler. New direct writes and delegated work appear in History; reads stay in the call transcript.

Example tool arguments:

```json
{"name":"get_latest_email","arguments":{}}
```

```json
{"name":"prepare_action","arguments":{"intent":"send_email","instruction":"Email Maria the meeting time","to":"maria@example.com","subject":"Meeting","body":"The meeting is at 14:30.","start_mode":"now","delivery_channels":[]}}
```

After the exact read-back and caller's approval:

```json
{"name":"decide_action","arguments":{"decision":"approve"}}
```

Explicit delegation:

```json
{"name":"create_task","arguments":{"intent":"research","instruction":"Compare three venues near Sofia","delegation_requested":true,"delegation_request":"Use Manus to research three venues in the background","start_mode":"now","delivery_channels":[]}}
```

## Concurrency and recovery

Migration `20261010163000_fast_voice_actions.sql` adds the service-only `alo_voice_action_requests` journal and `alo_voice_decide` RPC. The RPC locks call then task, verifies account, current reviewed revision, approval state and scheduling conditions, records the request ID and grants the same 120-second execution lease used by the background worker. Duplicate approvals replay status without claiming again. Overlapping scheduler runs cannot claim that lease.

Inline execution uses the existing execution journal, grant checks, current connections, cancellation fence and provider receipts. A provider timeout after a write started pauses as uncertain; it is not blindly retried. A worker restart reuses a succeeded step. Cancellation prevents later actions and cannot undo an in-flight request or completed write.

Scheduled and after-call direct actions remain waiting until due, then use the same worker without creating or initializing Manus. The worker initializes Manus lazily only for delegated work. `voice-tools` boots without `MANUS_API_KEY`.

## Deployment

1. Run delegated-task tests, the NOVA_VOICE checks/tests/lint, and review the migration.
2. Apply the additive migration to the intended Supabase project.
3. Deploy `voice-tools`, `create-task`, `get-task-status` and `task-worker`; deploy other affected functions when releasing all shared adapters.
4. Verify live reads and mocked writes before an explicitly authorized live write.
5. Run `NOVA_VOICE/scripts/setup-vapi.ts` with the existing secret environment. It installs ten synchronous reads and `prepare_action`, updates existing tools/prompts, and preserves the assistant's voice, model and reasoning configuration. Both GPT-Live speaker and reasoner instructions are updated and read back from Vapi to verify persistence. GPT-Live updates omit classic model.messages: the live API otherwise normalized away the appended native instructions during this rollout.
6. Start a **new call**; existing calls retain their original assistant snapshot.

To roll back routing, restore the saved assistant/tool configuration. The additive migration can remain. Never replay uncertain writes as a rollback measure.

## Validation

Automated coverage includes 20 mocked authenticated call-tool scenarios, ownership rejection, direct email read-back, ambiguous contacts, empty and HTML-only Inbox messages, expired-token refresh, disconnected providers, exact approvals, duplicate approvals, stale proposals, cancellation, leases, scheduled/after-call execution and zero Manus initialization for direct actions. Existing tests cover Bulgarian next-week interpretation and Sofia DST transitions, signed webhooks and delivery idempotency.

Twenty live read requests on 10 October 2026 (five each: latest email, Inbox search, next-week calendar and contact lookup) all succeeded. Client-observed backend latency: median **1.230s**, p95 **2.014s**, maximum **2.468s**. Their call fixture created **zero tasks and zero Manus tasks**. These measurements exclude speech recognition, reasoning and spoken playback; they do not establish end-to-end voice latency.

Voice regression scenarios cover latest email, next-week calendar, confirmed email and explicit delegation. Every configured tool is mocked for these simulations, so tests cannot send real mail, create events or start Manus work. Evaluate tool routing and spoken outcomes separately from backend timing. The release keeps voice/model/reasoning settings fixed.

No additional real email or calendar write was performed for this release. Places and Microsoft still need their provider credentials configured to pass live checks; they return actionable errors instead of simulated success.

### Repeat voice simulations

With `VAPI_API_KEY` and `VAPI_ASSISTANT_ID` in the environment, run:

```sh
python3 NOVA_VOICE/scripts/voice-regression.py create
python3 NOVA_VOICE/scripts/voice-regression.py run 5
python3 NOVA_VOICE/scripts/voice-regression.py status
python3 NOVA_VOICE/scripts/voice-regression.py items
```

This creates four reusable scenarios and runs each five times. Tool responses are mocked; Vapi voice simulation usage is still billable. A Bulgarian-capable tester has a 90-second limit. Use `cancel` to stop a run. Private results are saved under `/tmp/alo-voice-regression`, or `ALO_TEST_OUTPUT_DIR`. Do not commit raw call artifacts: they can contain configuration and tool-server credentials. Independently inspect call messages; an automated evaluator's pass is not proof that the final spoken result was heard.
