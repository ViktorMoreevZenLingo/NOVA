# NOVA AI

NOVA AI is a personal AI assistant. You use it in the web app, or you call it on the phone and it keeps working after you hang up.

**NOVA Coach** builds on the same stack: a personal AI coach that calls employees, remembers their goals and follows up, plus anonymous voice pulse check-ins whose aggregates (≥5 people) help managers, leadership and HR act, and measure whether it worked. How it works, local setup, real calls, deploy and demo videos: [NOVA_VOICE/README.md → NOVA Coach](NOVA_VOICE/README.md#nova-coach--employee-voice). Plan and principles: [coach-mvp-plan.md](NOVA_VOICE/docs/coach-mvp-plan.md).

```
phone (Vapi) ─▶ coach-tools ─┐                         ┌─ private coach memory (owner only)
browser ──────▶ coach ───────┼─▶ Supabase Postgres + RLS ┼─ anonymous survey answers (no user, no text)
pg_cron ──────▶ coach-worker ┘   (Edge Functions)       └─ insights_* aggregates for groups of ≥5 people
```

| Folder | What | Docs |
|---|---|---|
| [`NOVA_FE/`](NOVA_FE) | NOVA AI web app (Next.js): phone sign-in, profile, integrations, chat, History | [NOVA_FE/README.md](NOVA_FE/README.md) |
| [`NOVA_VOICE/`](NOVA_VOICE) | Phone assistant (Vapi → Manus) and NOVA Coach: tests, scripts (Vapi setup, demo seed), Vapi configs, docs | [NOVA_VOICE/README.md](NOVA_VOICE/README.md) |
| [`supabase/`](supabase) | Shared backend: one Postgres schema + migration history, and all Edge Functions (NOVA AI's `integrations`/`agent`/`account-delete`, the phone assistant's `create-task`/`get-task-status`/`manus-webhook`/`reconcile`, and NOVA Coach's `coach`/`coach-tools`/`coach-worker`) | [supabase/README.md](supabase/README.md), [DB contract](NOVA_VOICE/docs/db-contract.md) |
| Landing page (Lovable) | Public NOVA Coach site: hook, 2-minute demo video, how it works, roles, privacy, team. Static, no database access. Live: https://pixel-perfect-match-5365.lovable.app · repo: [novateamcrossroads/pixel-perfect-match-5365](https://github.com/novateamcrossroads/pixel-perfect-match-5365) (public, synced by Lovable) | [demo/lovable/](demo/lovable/README.md) |
| [`demo/`](demo) | Demo tooling: FE recordings (`record-fe.mjs`, `record-coach.mjs`), the 2-minute pitch video pipeline (`pitch/`), the local tunnel proxy for real calls | [NOVA_VOICE/README.md → Demo videos](NOVA_VOICE/README.md#demo-videos) |
| [`Design/`](Design) | Original visual prototype | [Design/README.md](Design/README.md) |
| [`NOVA_BE/`](NOVA_BE) | Legacy Spring Boot backend (reference only) | [NOVA_BE/README.md](NOVA_BE/README.md) |

**Deploy:** [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) pushes the migrations, sets the secrets and deploys all Edge Functions to the shared Supabase project on every push to `main`. The secrets are listed in [NOVA_VOICE/README.md](NOVA_VOICE/README.md#2-deploy-github-actions).

Delegated and scheduled cloud work: [ManusIntegration contract and deployment](docs/ManusIntegration.md).
