# NOVA AI

NOVA AI is a personal AI assistant. You use it in the web app, or you call it on the phone and it keeps working after you hang up.

| Folder | What | Docs |
|---|---|---|
| [`NOVA_FE/`](NOVA_FE) | NOVA AI web app (Next.js): phone sign-in, profile, integrations, chat, History | [NOVA_FE/README.md](NOVA_FE/README.md) |
| [`NOVA_VOICE/`](NOVA_VOICE) | Phone assistant (Vapi → Manus): tests, scripts, Vapi configs, docs | [NOVA_VOICE/README.md](NOVA_VOICE/README.md) |
| [`supabase/`](supabase) | Shared backend: one Postgres schema + migration history, and all Edge Functions (NOVA AI's `integrations`/`agent`/`account-delete` and the phone assistant's `create-task`/`get-task-status`/`manus-webhook`/`reconcile`) | [supabase/README.md](supabase/README.md), [DB contract](NOVA_VOICE/docs/db-contract.md) |
| [`Design/`](Design) | Original visual prototype | [Design/README.md](Design/README.md) |
| [`NOVA_BE/`](NOVA_BE) | Legacy Spring Boot backend (reference only) | [NOVA_BE/README.md](NOVA_BE/README.md) |

**Deploy:** [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) pushes the migrations, sets the secrets and deploys all Edge Functions to the shared Supabase project on every push to `main`. The secrets are listed in [NOVA_VOICE/README.md](NOVA_VOICE/README.md#2-deploy-github-actions).

Delegated and scheduled cloud work: [ManusIntegration contract and deployment](docs/ManusIntegration.md).
