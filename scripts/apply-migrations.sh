#!/usr/bin/env bash
# Applies supabase/migrations/*.sql that haven't run yet, each in its own
# transaction, tracked in public.nova_schema_migrations.
#
# We don't use `supabase db push` because the Lovable portal writes its own
# migrations to the same project; the CLI refuses to push while the shared
# history has entries this repo doesn't know. Our history stays separate.
#
# Connection via standard libpq env vars: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE.
set -euo pipefail
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
cd "$(dirname "$0")/.."

psql -v ON_ERROR_STOP=1 -q <<'SQL'
create table if not exists public.nova_schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);
alter table public.nova_schema_migrations enable row level security;
SQL

for file in supabase/migrations/*.sql; do
  version="$(basename "$file" .sql)"
  if [[ ! "$version" =~ ^[0-9]{14}_[a-z0-9_]+$ ]]; then
    echo "Refusing unexpected migration file name: $file" >&2
    exit 1
  fi
  applied="$(psql -tA -c "select 1 from public.nova_schema_migrations where version = '${version}'")"
  if [ -n "$applied" ]; then
    echo "skip   $version"
    continue
  fi
  echo "apply  $version"
  { cat "$file"; printf "\ninsert into public.nova_schema_migrations (version) values ('%s');\n" "$version"; } |
    psql -v ON_ERROR_STOP=1 -q --single-transaction
done
