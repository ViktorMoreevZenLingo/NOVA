# NOVA — notes for Claude Code

- Hackathon MVP: Vapi → Supabase Edge Functions (Deno) → Manus API v2 → email. Plan: `docs/implementation-plan.md`.
- **Keep `README.md` up to date** with every meaningful change: functions, secrets, migrations, setup steps, and the "mocked vs verified" table.
- Ownership:
  - Track B owns `supabase/functions/_shared/email/**` and `tests/email/**`. Don't edit those unless asked.
  - `_shared/contracts.ts` is the A↔B contract. Only change it if both tracks agree.
  - The DB schema is the contract with the Lovable portal (`docs/db-contract.md`). Change it only through new migrations, and update that doc.
  - Lovable owns its own tables in the same project (e.g. `public.profiles`) and its own migration history. Our objects use non-colliding names (`assistant_profiles`, `nova_*` functions). Remote migrations go through `scripts/apply-migrations.sh` (tracked in `nova_schema_migrations`), never `supabase db push`.
- Patterns:
  - Each function has `handler.ts` (pure, dependency-injected, tested) and `index.ts` (wires env + real clients).
  - DB status changes go through `store.transition(id, fromStatuses, patch)`. Never update a status unconditionally.
  - Email only goes out via `notifyTask` (claim → send → release).
  - Vapi responses are always HTTP 200 `{results:[{toolCallId, result|error}]}`.
  - Logs go through `_shared/log.ts`. Never log PINs, secrets, prompts or results.
- Verify with `deno task test`, `deno task check`, `deno task lint`. For SQL, run `tests/sql/rls.sql` against `supabase start`.
- Before calling something "verified" against Manus/Vapi/Resend, run it for real and update the README status table.
