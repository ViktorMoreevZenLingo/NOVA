# DB contract for the portal (Track C, Lovable)

The Lovable portal connects to the **same Supabase project** as the backend. In Lovable, use *Connect Supabase* with the existing project, **not** Lovable Cloud. The portal only **reads** data with the signed-in user's session. Row-level security makes sure each user sees only their own rows.

> ⚠️ Track A owns the schema in `NOVA/supabase/migrations`. Don't let Lovable create or alter these tables. If the portal needs a schema change, ask Track A to add a migration.

## Tables

### `assistant_profiles` (one row per user, created automatically on sign-up; separate from Lovable's own `profiles`)
| column | type | portal access |
|---|---|---|
| `user_id` | uuid, = `auth.users.id` | read |
| `display_name` | text | read + **update** |
| `notify_email` | text, nullable | read only (the sign-up email; results are emailed here) |
| `phone_e164` | text, e.g. `+359888123456` | read only (set by admin for now) |
| `created_at`, `updated_at` | timestamptz | read |

### `user_integrations` (one row per user and provider, written by the backend)
| column | type | notes |
|---|---|---|
| `provider` | `gmail` \| `google_calendar` \| `slack` \| `home_assistant` | |
| `status` | `not_connected` \| `pending` \| `connected` \| `error` | a missing row means `not_connected` |
| `metadata` | jsonb | display hints, e.g. `{ "account": "demo@gmail.com" }` |
| `updated_at` | timestamptz | |

### `agent_tasks` (tasks created by phone, newest first)
| column | type | notes |
|---|---|---|
| `id` | uuid | the spoken "reference" is the first 4 characters, uppercase |
| `intent` | `summarize_emails` \| `research` | |
| `prompt` | text | what the user asked for |
| `status` | `pending` \| `submitted` \| `submit_failed` \| `completed` \| `needs_input` \| `failed` | see the labels below |
| `result` | text | the agent's answer (also emailed) |
| `manus_task_url` | text | link to the task in Manus |
| `error_message` | text | user-facing reason when `failed` |
| `created_at`, `updated_at`, `completed_at`, `notified_at` | timestamptz | `notified_at` = when the latest email was actually delivered |

Suggested status labels:
- `pending` / `submitted` → "Working…"
- `submit_failed` → "Retrying…"
- `completed` → "Done"
- `needs_input` → "Needs your input" (link to `manus_task_url`)
- `failed` → "Failed"

## Example queries (supabase-js)

```ts
// Profile
const { data: profile } = await supabase.from("assistant_profiles").select("*").single();

// Rename
await supabase.from("assistant_profiles").update({ display_name: "Alice" }).eq("user_id", user.id);

// Integrations
const { data: integrations } = await supabase.from("user_integrations").select("provider, status, metadata, updated_at");

// Task history
const { data: tasks } = await supabase
  .from("agent_tasks")
  .select("id, intent, prompt, status, result, manus_task_url, error_message, created_at, completed_at")
  .order("created_at", { ascending: false })
  .limit(50);

// Live updates (task status flips after the call ends)
supabase
  .channel("my-tasks")
  .on("postgres_changes", { event: "*", schema: "public", table: "agent_tasks" }, (payload) => {
    // payload.new is the updated row; RLS already filters to the current user
  })
  .subscribe();
```

## Not available to the portal
- Writing to `agent_tasks` or `user_integrations`. Only the backend writes them.
- `call_sessions` (internal).
- Changing `notify_email` or `phone_e164`. Phone/PIN setup isn't in the MVP; an admin sets the phone number with SQL.
