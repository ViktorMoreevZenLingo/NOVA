# Alo Supabase backend

Target: `vlimtocbrxxnzobhkcoy` (Nova Team Project).

## Database

The initial SQL is in `migrations/20261010094249_alo_accounts_and_activity.sql`.
Both migrations have been applied to Nova and recorded in migration history.
For another fresh project, use `supabase db push` after linking it.

- `profiles`: owner read/create/update, 80-character name, 100,000-character context.
- `activity`: owner read only. Trusted server workers write call/task/SMS history.
- `connections`: owner read only. Only successful consent enables a service.
- `provider_tokens`, `oauth_states`, `agent_state`: server-only; RLS and revoked
  browser grants. OAuth states expire in ten minutes and are consumed atomically.
- All user-owned rows cascade on account deletion. Privileged functions verify
  the live Auth user instead of trusting user IDs or phone numbers in requests.

Run `tests/rls.sql` in SQL Editor. It uses a transaction and rolls back all fixtures.
It verifies ownership isolation, blocked cross-user updates, private credentials,
blocked forged connection/history records and anonymous access.

## Functions and secrets

```sh
supabase functions deploy integrations agent account-delete --project-ref vlimtocbrxxnzobhkcoy --use-api
supabase secrets set --env-file supabase/functions/.env.local --project-ref vlimtocbrxxnzobhkcoy
```

Copy `functions/.env.example` to the ignored `.env.local` and populate it.
`APP_URL` must be the exact frontend origin (for example `http://localhost:3000`),
not a URL supplied by a browser request. Supabase supplies its own URL/service key.
Keep all provider keys and refresh tokens out of frontend environment variables.

Functions use explicit `auth.getUser(token)` verification; platform JWT checking
is disabled to support the OAuth callback and asymmetric signing keys. Only the
OAuth callback accepts GET without a Supabase session, and it requires a random,
expiring, single-use state and PKCE verifier from an authenticated initiation.

## Provider setup

**Phone Auth:** enable Phone provider and configure SMS delivery in Supabase
Authentication. Configure rate limits/CAPTCHA for public rollout. Add a test
phone/OTP pair for local testing if desired; do not add production bypass codes.

**Google:** enable Gmail, Calendar, and People APIs in your OAuth app. Add scopes
`gmail.modify`, `calendar`, and `contacts.readonly` under the Google API prefix.
Use a Web application OAuth client. Register this exact redirect URI:

```
https://vlimtocbrxxnzobhkcoy.supabase.co/functions/v1/integrations
```

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Edge Function secrets. Add test
users while Google's app is in Testing. The end user clicks Connect inside Alo,
sees Google's consent screen, and returns to Alo. No user Supabase setup is needed.
Disconnect removes Alo's stored access; users can also revoke the provider grant
in Google's account settings. Revoking one Google grant can affect other services.

**Outlook:** register a Microsoft web app supporting the intended account types,
with the same callback URI. Delegated Graph permissions: Mail.Read,
Calendars.Read, Contacts.Read, plus offline_access. Configure Microsoft client ID
and secret. Writes are not offered for Outlook.

**Places:** enable Places API (New) and set `GOOGLE_PLACES_API_KEY`. This is an
Alo-level service key; a user enables it in Alo without a Google login.

**Assistant:** set `OPENAI_API_KEY`, optionally `OPENAI_MODEL` and `APP_TIMEZONE`.
Email/calendar write approval is single-use and consumed before the provider
request. If the worker/network fails during a write, check the provider before
retrying. A per-user lease serializes chat turns; saved messages survive reloads.

## Validation

```sh
npx deno check --config supabase/functions/deno.json supabase/functions/agent/index.ts supabase/functions/integrations/index.ts supabase/functions/account-delete/index.ts
```

Test phone login, reload, profile edits, consent rejection/success, disconnect,
chat approval/rejection, and account deletion using dedicated test accounts.
No real SMS, emails, or calendar events should be sent by automated smoke checks.
