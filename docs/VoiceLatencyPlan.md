> Implemented direct routing: see [Fast voice requests](FastVoiceRequests.md) for deployment, measured backend latency and the remaining voice validation.

# Alo voice latency: findings and implementation plan

10 October 2026. Based on the live Vapi configuration, call timestamps, and the failed calendar task. Improvements below are not claimed as measured until repeated calls verify them.

## Evidence and fixes applied

- One inspected date-question turn took about **6.8 seconds** from the caller finishing to the actual answer. A filler response began after about 1.2 seconds. The result was correct, but the speaker delegated a simple date check through the reasoner and `get_call_context`. Tool timestamps are too coarse to attribute that whole delay to backend execution.
- The live model is **GPT-Live**, with separate speaker and reasoner instructions. The setup script had updated classic system messages, which explicit speaker instructions override. Setup now updates the active fields idempotently while preserving the configured model, voice, and reasoning settings. The speaker receives the Sofia clock and instructions to answer date/year questions directly. The reasoner receives the actual Alo task procedures.
- Calendar summaries went through an unnecessary Manus turn to request data Alo already knew how to fetch. Alo now resolves the date range and preloads a journalled calendar read before asking Manus to summarize. “Next week” is next Monday–Sunday, not a contradictory 14-day rolling window.
- Manus requested `max: 50`, but validation allowed 25 while the calendar provider supported 50. Shared query limits now keep the tool schema and validation aligned. Other invalid or unsupported requests remain blocked.
- History displays the task's current result/error once. Failed and waiting statuses use the same rounded chip layout as other states.

The saved Soniox English configuration is misleading, but **classic transcriber, TTS, and speaking-plan controls do not configure GPT-Live**. Do not try to fix this call path by tuning those fields. Reasoner model/effort were not explicitly set in the inspected assistant; Vapi documents defaults of `gpt-5.6-terra` / `low`. [GPT-Live configuration](https://docs.vapi.ai/gpt-live/configuration)

## Next implementation, in priority order

1. **Direct tools for short requests.** Add a synchronous, authenticated read endpoint for Calendar, Contacts and bounded Gmail lookups. Resolve the account server-side, check the current connection, call the existing provider adapter, and return a compact result to the Vapi reasoner. The speaker answers from that result. This removes Manus task creation, polling and continuation from simple in-call lookups. Never accept a caller-supplied account ID. Keep current write approvals and receipt checks.

2. **Reserve Manus for background work.** Route research, multi-step synthesis, after-call work and scheduled tasks through the durable queue. Acknowledge once as saved/scheduled, then let the caller continue or hang up. Results stay in History and use only requested delivery. A short read should not silently become a minutes-long task; if it times out, explain and offer background work.

3. **Reuse call context deliberately.** Load profile/connections only when account work is needed, reuse the result within that verified call, and avoid loading it for general conversation or today's date. Return only task-relevant context and bounded provider data. Recheck permissions before writes, and refresh context when a connection changes. Do not cache calendar results across unrelated requests or accounts.

4. **Compare reasoner settings on a test assistant.** Keep the current GPT-Live voice. Compare the current default with `reasoningEffort: none`, then a smaller supported reasoner. Change one variable at a time. Promote only if Bulgarian comprehension, date resolution, exact approval, cancellation and truthful completion all pass. The speaker cannot call integration tools directly in GPT-Live, so one reasoner delegation remains necessary for live account data. [Tool architecture](https://docs.vapi.ai/gpt-live/tools)

5. **Measure useful answers and completion separately.** Record caller speech-end, delegation start, backend receipt, provider start/end, tool response and spoken-answer start using call/task IDs, without storing secrets or full provider content in logs. Report median and p95 for acknowledgements, actual answers and final completion. Track failure/repetition/incorrect-success rates alongside speed. [Vapi testing and latency guidance](https://docs.vapi.ai/gpt-live/testing)

## Validation and rollout

Use at least 20 repeated Bulgarian scenarios: date/year, tomorrow/next-week calendar, contact lookup, bounded inbox lookup, missing connection, event read-back, changed event details, rejection, cancellation, interruptions, and background research. Exercise Sofia daylight-saving boundaries and spoken names/numbers. Use mocked writes in automated scenarios, then a specifically authorized live write.

Initial targets, to validate rather than promise: median direct conversational answer under 1.5 seconds, median simple integration answer under 3 seconds, p95 under 5 seconds. No false success claims, unauthorized writes, duplicate writes or identity questions. Check recordings as well as timestamp logs. GPT-Live's classic STT/TTS metrics and simulation latency thresholds do not measure this pipeline.

Release one change at a time; retain the previous assistant configuration for rollback. Verify backend behaviour and real call quality before switching all calls to a different reasoner. The direct-read endpoint and model comparison remain planned, not deployed.
