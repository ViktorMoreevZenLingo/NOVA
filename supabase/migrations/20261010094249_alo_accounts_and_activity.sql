-- Client-readable data is owner-scoped. Provider credentials and agent state
-- are accessible only to trusted Edge Functions, never to browser clients.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  notes text not null default '' check (char_length(notes) <= 100000),
  photo text not null default '' check (photo = '' or (char_length(photo) <= 2800000 and photo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$'))
);
alter table public.profiles enable row level security;
grant select, insert, update on public.profiles to authenticated;
revoke all on public.profiles from anon;
create policy own_profile_read on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy own_profile_insert on public.profiles for insert to authenticated with check (id = (select auth.uid()));
create policy own_profile_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create table public.connections (
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null check (service in ('gmail','calendar','contacts','outlook','places')),
  connected_at timestamptz not null default now(),
  primary key (user_id,service)
);
alter table public.connections enable row level security;
revoke all on public.connections from anon, authenticated;
grant select on public.connections to authenticated;
create policy own_connections_read on public.connections for select to authenticated using (user_id = (select auth.uid()));

create table public.activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('call','callback','task','sms')),
  date timestamptz not null default now(),
  status text not null default 'done',
  duration text,
  title jsonb not null,
  detail jsonb,
  message jsonb,
  transcript jsonb not null default '[]',
  call uuid,
  task uuid,
  unique (user_id,id),
  foreign key (user_id,call) references public.activity(user_id,id),
  foreign key (user_id,task) references public.activity(user_id,id)
);
create index activity_user_date on public.activity(user_id,date desc);
create index activity_call on public.activity(user_id,call);
create index activity_task on public.activity(user_id,task);
alter table public.activity enable row level security;
revoke all on public.activity from anon, authenticated;
grant select on public.activity to authenticated;
create policy own_activity_read on public.activity for select to authenticated using (user_id = (select auth.uid()));

-- RLS with no browser policies intentionally denies all browser access.
create table public.provider_tokens (
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text not null,
  primary key(user_id,service)
);
create table public.oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null,
  verifier text not null,
  expires_at timestamptz not null default now() + interval '10 minutes'
);
create table public.agent_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  messages jsonb not null default '[]',
  pending jsonb,
  lock_id uuid,
  lock_until timestamptz
);
alter table public.provider_tokens enable row level security;
alter table public.oauth_states enable row level security;
alter table public.agent_state enable row level security;
revoke all on public.provider_tokens, public.oauth_states, public.agent_state from anon, authenticated;
grant all on public.profiles, public.connections, public.activity, public.provider_tokens, public.oauth_states, public.agent_state to service_role;
