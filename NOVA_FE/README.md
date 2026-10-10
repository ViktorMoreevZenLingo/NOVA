# NOVA AI — Supabase branch

The React frontend in `NOVA_FE` uses Supabase Auth, Postgres and Edge Functions.
`NOVA_BE` is retained as a reference; this branch no longer calls Spring.
`Design` remains the original visual prototype.

## Run

```sh
npm ci
cp .env.example .env.local
# Add the project's publishable key (never a service-role key).
npm run dev
```

Open http://localhost:3000. Authentication requires Supabase Phone Auth with a
configured SMS provider. There is no fixed code or fallback simulated login.
For development, use Supabase's configured test phone/OTP pairs rather than
sending real SMS. Existing browser-only profiles are not silently uploaded.

## Backend deployment

See `../supabase/README.md` for migration, secrets, provider callbacks and tests.
The frontend uses `lib/account-api.ts` for auth/profile/history/connections and
`lib/agent-api.ts` for assistant requests. Secrets stay in Edge Functions.

The client restores sessions and loads only rows permitted by RLS. Profiles
(including small avatar data URLs) persist in Postgres. Connections are set by
verified provider callbacks. History has no fabricated records: it reads the
`activity` table. A trusted telephony worker can write call/SMS transcripts to
that table; Vapi webhooks are not part of this migration.

Google services use separate incremental consent flows. Outlook uses Microsoft
consent. Places uses NOVA AI's server API key and does not require Google user OAuth.
The assistant supports Google email/calendar/contacts, read-only Outlook, and
Places searches. Email sends/calendar creation require explicit approval tied
to a server-stored action ID. Ambiguous external-write failures are not retried.

## Checks

```sh
npm run typecheck
npm run build
npm audit
```

Next 15's webpack module concatenation hits `matchModuleReference` JSON parsing
with the current Supabase ESM build; concatenation is disabled in
`next.config.mjs`. Tree shaking remains enabled. PostCSS is pinned by an override
to its patched version without changing the Next framework version.
