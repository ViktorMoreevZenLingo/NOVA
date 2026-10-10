-- NOVA Coach + Employee Voice (plan: NOVA_VOICE/docs/coach-mvp-plan.md).
--
-- Two data domains that never mix:
--   * coach_*   personal memory of one employee. Only the owner reads it; only shares the
--               owner approved reach their manager.
--   * survey_*  anonymous engagement/pulse answers. survey_responses has NO user_id and no
--               browser grant at all; managers, leadership and HR read aggregates through the
--               insights_* functions, which return numbers only for groups of >= 5 answers.
-- Roles live in org_members: employee | manager (own department subtree) |
-- leader (whole org, or own division when department_id is set) | hr (whole org).

-- ---------------------------------------------------------------- organisation
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);
create table public.departments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  parent_id uuid references public.departments(id) on delete set null,
  name text not null check (char_length(name) between 1 and 120)
);
create index departments_org on public.departments(org_id);
create table public.org_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  manager_user_id uuid references auth.users(id) on delete set null,
  role text not null default 'employee' check (role in ('employee','manager','leader','hr')),
  display_name text check (char_length(display_name) <= 120),
  created_at timestamptz not null default now()
);
create index org_members_org on public.org_members(org_id, department_id);
alter table public.orgs enable row level security;
alter table public.departments enable row level security;
alter table public.org_members enable row level security;
revoke all on public.orgs, public.departments, public.org_members from public, anon, authenticated;
grant all on public.orgs, public.departments, public.org_members to service_role;

/** Minimum group size for any number shown to managers, leadership or HR. */
create function public.insights_min_group() returns int language sql immutable as $$ select 5 $$;

/** Departments whose aggregates the caller may see (empty for employees). */
create function public.insights_scope() returns table(department_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive me as (
    select org_id, department_id, role from org_members where user_id = (select auth.uid())
  ), tree as (
    select d.id from departments d join me on d.org_id = me.org_id
     where me.role = 'hr'
        or (me.role = 'leader' and (me.department_id is null or d.id = me.department_id))
        or (me.role = 'manager' and d.id = me.department_id)
    union
    select d.id from departments d join tree t on d.parent_id = t.id
  )
  select id from tree
$$;

/** The caller's own department and all its parents (for "You said, we did"). */
create function public.coach_my_departments() returns table(department_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive up as (
    select d.id, d.parent_id from departments d
      join org_members m on m.department_id = d.id where m.user_id = (select auth.uid())
    union
    select d.id, d.parent_id from departments d join up on d.id = up.parent_id
  )
  select id from up
$$;

/** Caller's role in an org (null when not a member). Lets RLS policies avoid reading org_members directly. */
create function public.coach_my_role(p_org uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select role from org_members where user_id = (select auth.uid()) and org_id = p_org
$$;

/** Caller's membership for the app: role and names only. */
create function public.coach_my_membership()
returns table(org_id uuid, org_name text, department_id uuid, department_name text, role text, manager_name text, display_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select m.org_id, o.name, m.department_id, d.name, m.role,
         coalesce(mm.display_name, mp.name), coalesce(m.display_name, p.name)
    from org_members m
    join orgs o on o.id = m.org_id
    left join departments d on d.id = m.department_id
    left join org_members mm on mm.user_id = m.manager_user_id
    left join profiles mp on mp.id = m.manager_user_id
    left join profiles p on p.id = m.user_id
   where m.user_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------- coach (personal)
create table public.coach_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  manager_email text check (manager_email is null or manager_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  manager_name text check (char_length(manager_name) <= 120),
  call_days smallint[] not null default '{1,2,3,4,5}' check (call_days <@ '{0,1,2,3,4,5,6}'),
  call_from time not null default '09:30',
  call_to time not null default '18:30',
  timezone text not null default 'Europe/Sofia' check (char_length(timezone) between 1 and 64),
  followups_enabled boolean not null default true,
  surveys_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  check (call_from < call_to)
);

create table public.coach_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  why text check (char_length(why) <= 1000),
  status text not null default 'active' check (status in ('active','paused','done','dropped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);
create index coach_goals_user on public.coach_goals(user_id, updated_at desc);

create table public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid,
  kind text not null check (kind in ('motivation','blocker','tension','insight')),
  text text not null check (char_length(text) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (user_id, goal_id) references public.coach_goals(user_id, id) on delete set null (goal_id)
);
create index coach_notes_user on public.coach_notes(user_id, created_at desc);

create table public.coach_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid,
  text text not null check (char_length(text) between 1 and 300),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open','done','partial','skipped')),
  outcome text check (char_length(outcome) <= 1000),
  reflection text check (char_length(reflection) <= 1000),
  -- Follow-up call state: written by the trigger and the worker only (no browser grant).
  followup_status text not null default 'none'
    check (followup_status in ('none','scheduled','calling','called','failed','cancelled')),
  followup_at timestamptz,
  followup_claimed_at timestamptz,
  followup_attempts int not null default 0,
  followup_call_id text,
  source_tool_call_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, goal_id) references public.coach_goals(user_id, id) on delete set null (goal_id)
);
create index coach_steps_user on public.coach_steps(user_id, created_at desc);
create index coach_steps_followup on public.coach_steps(followup_at) where followup_status = 'scheduled';

-- A step with a due date schedules its follow-up; closing it cancels a pending one.
create function public.coach_steps_schedule() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  if new.status = 'open' and new.due_at is not null
     and (tg_op = 'INSERT' or new.due_at is distinct from old.due_at or old.status <> 'open')
     and new.followup_status in ('none','scheduled','cancelled','failed','called') then
    new.followup_status := 'scheduled';
    new.followup_at := new.due_at;
    new.followup_attempts := 0;
  elsif new.status <> 'open' and new.followup_status = 'scheduled' then
    new.followup_status := 'cancelled';
  end if;
  return new;
end $$;
create trigger coach_steps_schedule before insert or update on public.coach_steps
  for each row execute function public.coach_steps_schedule();
revoke all on function public.coach_steps_schedule() from public, anon, authenticated;

create function public.coach_touch() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at := now(); return new; end $$;
create trigger coach_goals_touch before update on public.coach_goals for each row execute function public.coach_touch();
create trigger coach_profiles_touch before update on public.coach_profiles for each row execute function public.coach_touch();
revoke all on function public.coach_touch() from public, anon, authenticated;

create table public.coach_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid,
  text text not null check (char_length(text) between 1 and 500),
  -- Set by the server from org_members / coach_profiles, never by the model.
  recipient_user_id uuid references auth.users(id) on delete set null,
  recipient_email text,
  status text not null default 'draft' check (status in ('draft','approved','sent','rejected')),
  approved_via text check (approved_via in ('call','app')),
  manager_status text not null default 'new' check (manager_status in ('new','acknowledged','planned','done')),
  manager_note text check (char_length(manager_note) <= 500),
  source_tool_call_id text unique,
  -- Voice approval applies only to a draft read back on the same call/session.
  source_call_id text,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (user_id, goal_id) references public.coach_goals(user_id, id) on delete set null (goal_id)
);
create index coach_shares_user on public.coach_shares(user_id, created_at desc);
create index coach_shares_recipient on public.coach_shares(recipient_user_id, created_at desc);
create trigger coach_shares_touch before update on public.coach_shares for each row execute function public.coach_touch();

alter table public.coach_profiles enable row level security;
alter table public.coach_goals enable row level security;
alter table public.coach_notes enable row level security;
alter table public.coach_steps enable row level security;
alter table public.coach_shares enable row level security;
revoke all on public.coach_profiles, public.coach_goals, public.coach_notes, public.coach_steps, public.coach_shares
  from public, anon, authenticated;
grant all on public.coach_profiles, public.coach_goals, public.coach_notes, public.coach_steps, public.coach_shares to service_role;

grant select, insert, update on public.coach_profiles to authenticated;
create policy own_coach_profile_read on public.coach_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy own_coach_profile_insert on public.coach_profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_coach_profile_update on public.coach_profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

grant select, delete on public.coach_goals, public.coach_notes, public.coach_steps to authenticated;
grant insert (user_id, title, why, status), update (title, why, status) on public.coach_goals to authenticated;
grant insert (user_id, goal_id, kind, text), update (kind, text) on public.coach_notes to authenticated;
grant insert (user_id, goal_id, text, due_at), update (text, due_at, status, outcome, reflection) on public.coach_steps to authenticated;
create policy own_coach_goals on public.coach_goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_coach_notes on public.coach_notes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_coach_steps on public.coach_steps for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Shares: the owner sees all of theirs; the manager sees only what the owner approved.
grant select on public.coach_shares to authenticated;
create policy own_coach_shares_read on public.coach_shares for select to authenticated using (user_id = (select auth.uid()));
create policy recipient_coach_shares_read on public.coach_shares for select to authenticated
  using (recipient_user_id = (select auth.uid()) and status in ('approved','sent'));

/** Manager's reply to an approved share (shown back to the employee). */
create function public.coach_share_respond(p_id uuid, p_status text, p_note text default null) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('acknowledged','planned','done') then raise exception 'invalid status'; end if;
  update coach_shares set manager_status = p_status, manager_note = left(nullif(trim(p_note), ''), 500)
   where id = p_id and recipient_user_id = (select auth.uid()) and status in ('approved','sent');
  return found;
end $$;

/** Approved requests addressed to the caller, with the employee's name (they chose to share it). */
create function public.coach_team_requests()
returns table(id uuid, text text, status text, manager_status text, manager_note text, created_at timestamptz, employee_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.text, s.status, s.manager_status, s.manager_note, s.created_at,
         coalesce(nullif(p.name, ''), m.display_name, 'A team member')
    from coach_shares s
    left join org_members m on m.user_id = s.user_id
    left join profiles p on p.id = s.user_id
   where s.recipient_user_id = (select auth.uid()) and s.status in ('approved','sent')
   order by s.created_at desc
$$;

/** The owner rejects a draft from the app (approval goes through the coach function, which delivers it). */
create function public.coach_share_reject(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update coach_shares set status = 'rejected', decided_at = now(), approved_via = 'app'
   where id = p_id and user_id = (select auth.uid()) and status = 'draft';
  return found;
end $$;

-- ---------------------------------------------------------------- surveys (anonymous)
create table public.survey_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  kind text not null check (kind in ('engagement','pulse')),
  title text not null check (char_length(title) between 1 and 120),
  questions jsonb not null check (jsonb_typeof(questions) = 'array'),
  department_ids uuid[] not null default '{}',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'live' check (status in ('draft','live','closed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index survey_campaigns_org on public.survey_campaigns(org_id, created_at desc);

-- Who was asked and whether they answered. Never the answer itself.
create table public.survey_invites (
  campaign_id uuid not null references public.survey_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','calling','called','answered','declined','failed')),
  attempts int not null default 0,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  call_id text,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, user_id)
);
create index survey_invites_user on public.survey_invites(user_id, status);
create index survey_invites_due on public.survey_invites(next_attempt_at) where status = 'pending';

-- Anonymous: no user_id, no timestamp finer than a day, no free text.
create table public.survey_responses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.survey_campaigns(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  department_id uuid references public.departments(id) on delete set null,
  response_day date not null default current_date,
  scores jsonb not null default '{}',
  score_index numeric(5,2) check (score_index between 0 and 100),
  enps smallint check (enps between 0 and 10),
  sentiment numeric(3,2) check (sentiment between -1 and 1),
  engagement numeric(5,2) check (engagement between 0 and 100),
  concerns text[] not null default '{}'
    check (concerns <@ '{workload,growth,recognition,manager_support,team,clarity,pay,wellbeing,tools,other}'),
  strengths text[] not null default '{}'
    check (strengths <@ '{workload,growth,recognition,manager_support,team,clarity,pay,wellbeing,tools,other}'),
  attrition_signals text[] not null default '{}'
    check (attrition_signals <@ '{considering_leaving,no_growth,burnout,undervalued,manager_conflict,pay}')
);
create index survey_responses_scope on public.survey_responses(org_id, department_id, response_day);

-- "You said, we did": actions managers/leadership/HR commit to, optionally published to employees.
create table public.action_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  department_id uuid references public.departments(id) on delete cascade,
  campaign_id uuid references public.survey_campaigns(id) on delete set null,
  theme text check (theme in ('workload','growth','recognition','manager_support','team','clarity','pay','wellbeing','tools','other')),
  title text not null check (char_length(title) between 1 and 160),
  detail text check (char_length(detail) <= 1000),
  owner_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'planned' check (status in ('planned','in_progress','done')),
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index action_items_org on public.action_items(org_id, created_at desc);
create trigger action_items_touch before update on public.action_items for each row execute function public.coach_touch();

alter table public.survey_campaigns enable row level security;
alter table public.survey_invites enable row level security;
alter table public.survey_responses enable row level security;
alter table public.action_items enable row level security;
revoke all on public.survey_campaigns, public.survey_invites, public.survey_responses, public.action_items
  from public, anon, authenticated;
grant all on public.survey_campaigns, public.survey_invites, public.survey_responses, public.action_items to service_role;

grant select on public.survey_invites to authenticated;
create policy own_survey_invites on public.survey_invites for select to authenticated using (user_id = (select auth.uid()));

grant select on public.survey_campaigns to authenticated;
create policy invited_campaigns on public.survey_campaigns for select to authenticated
  using (exists (select 1 from public.survey_invites i where i.campaign_id = survey_campaigns.id and i.user_id = (select auth.uid())));
create policy scoped_campaigns on public.survey_campaigns for select to authenticated
  using (public.coach_my_role(org_id) in ('manager','leader','hr'));

grant select on public.action_items to authenticated;
create policy scoped_actions on public.action_items for select to authenticated
  using (department_id in (select department_id from public.insights_scope())
         or (department_id is null and public.coach_my_role(org_id) in ('leader','hr')));
create policy published_actions on public.action_items for select to authenticated
  using (published and public.coach_my_role(org_id) is not null
         and (department_id is null or department_id in (select department_id from public.coach_my_departments())));

/** Default question banks. Scale questions are 1-5; the eNPS question is 0-10. */
create function public.survey_default_questions(p_kind text) returns jsonb language sql immutable as $$
  select case when p_kind = 'engagement' then '[
    {"id":"enps","type":"enps","text":"On a scale from 0 to 10, how likely are you to recommend working here to a friend?"},
    {"id":"energy","type":"scale","text":"From 1 to 5, how energized do you feel about your work lately?"},
    {"id":"growth","type":"scale","text":"From 1 to 5, how much are you learning and growing in your role?"},
    {"id":"support","type":"scale","text":"From 1 to 5, how supported do you feel by your manager and team?"},
    {"id":"better","type":"open","text":"What is one thing that would make your work better?"}
  ]'::jsonb else '[
    {"id":"week","type":"scale","text":"From 1 to 5, how was your work week?"},
    {"id":"support","type":"scale","text":"From 1 to 5, how supported did you feel this week?"},
    {"id":"better","type":"open","text":"What got in your way, or what helped, this week?"}
  ]'::jsonb end
$$;

/**
 * Atomically marks the caller's invite answered and stores the anonymous response
 * (department copied from org_members). Service role only; false if already answered.
 */
create function public.survey_record_response(
  p_user uuid, p_campaign uuid, p_scores jsonb, p_score_index numeric, p_enps smallint, p_sentiment numeric,
  p_engagement numeric, p_concerns text[], p_strengths text[], p_attrition text[]
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare m org_members; c survey_campaigns;
begin
  select * into c from survey_campaigns where id = p_campaign and status = 'live';
  if not found then return false; end if;
  select * into m from org_members where user_id = p_user and org_id = c.org_id;
  if not found then return false; end if;
  update survey_invites set status = 'answered', updated_at = now()
   where campaign_id = p_campaign and user_id = p_user and status in ('pending','calling','called','failed');
  if not found then return false; end if;
  insert into survey_responses(campaign_id, org_id, department_id, scores, score_index, enps, sentiment, engagement,
                               concerns, strengths, attrition_signals)
  values (p_campaign, c.org_id, m.department_id, coalesce(p_scores, '{}'), p_score_index, p_enps, p_sentiment, p_engagement,
          coalesce(p_concerns, '{}'), coalesce(p_strengths, '{}'), coalesce(p_attrition, '{}'));
  return true;
end $$;

-- ---------------------------------------------------------------- insights (aggregates only)
/**
 * Per department in scope plus a scope-wide row (department_id null). A group is shown only when it
 * has >= 5 members AND some check-in in the window got >= 5 answers (one answer per person per
 * check-in, so that is >= 5 distinct people). Counting answers alone would let 4 people who answer
 * weekly pass the floor. Metrics are null when suppressed.
 */
create function public.insights_departments(p_days int default 28)
returns table(department_id uuid, name text, parent_id uuid, members int, responses int, suppressed boolean,
              engagement numeric, score_index numeric, sentiment numeric, enps int, attrition_share numeric,
              prev_engagement numeric, response_rate numeric, concerns jsonb, strengths jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  with scope as (select department_id from insights_scope()),
  k as (select insights_min_group() k),
  win as (select greatest(1, least(coalesce(p_days, 28), 365)) d),
  base as (
    select r.*, (r.response_day > current_date - (select d from win)) cur
      from survey_responses r
     where r.department_id in (select department_id from scope)
       and r.response_day > current_date - 2 * (select d from win)
  ),
  agg as (
    select b.department_id, grouping(b.department_id) = 1 is_total,
           count(*) filter (where cur) n,
           avg(engagement) filter (where cur) eng,
           avg(score_index) filter (where cur) si,
           avg(sentiment) filter (where cur) sent,
           round(100.0 * (count(*) filter (where cur and enps >= 9) - count(*) filter (where cur and enps <= 6))
                 / nullif(count(*) filter (where cur and enps is not null), 0))::int enps,
           avg((cardinality(attrition_signals) > 0)::int) filter (where cur) attr,
           count(*) filter (where not cur) prev_n,
           avg(engagement) filter (where not cur) prev_eng
      from base b group by grouping sets ((b.department_id), ())
  ),
  -- Largest single check-in per group and period = a lower bound on distinct respondents.
  peaks as (
    select x.department_id, x.is_total, max(x.c) filter (where x.cur) peak, max(x.c) filter (where not x.cur) prev_peak
      from (select b.department_id, grouping(b.department_id) = 1 is_total, b.campaign_id, b.cur, count(*) c
              from base b group by grouping sets ((b.department_id, b.campaign_id, b.cur), (b.campaign_id, b.cur))) x
     group by x.department_id, x.is_total
  ),
  headcount as (
    select m.department_id, grouping(m.department_id) = 1 is_total, count(*) n
      from org_members m where m.department_id in (select department_id from scope)
     group by grouping sets ((m.department_id), ())
  ),
  themes as (
    select t.department_id, grouping(t.department_id) = 1 is_total, t.kind, t.theme, count(*) c
      from (select b.department_id, 'concern' kind, x theme from base b, unnest(b.concerns) x where b.cur
            union all
            select b.department_id, 'strength', x from base b, unnest(b.strengths) x where b.cur) t
     group by grouping sets ((t.department_id, t.kind, t.theme), (t.kind, t.theme))
  ),
  -- manager_support is a development signal for leadership, shown only after 2+ campaigns.
  history as (
    select r.department_id, count(distinct r.campaign_id) campaigns from survey_responses r
     where r.department_id in (select department_id from scope) group by r.department_id
  ),
  invites as (
    select m.department_id, count(*) total, count(*) filter (where i.status = 'answered') answered
      from survey_invites i join survey_campaigns c on c.id = i.campaign_id
      join org_members m on m.user_id = i.user_id and m.org_id = c.org_id
     where m.department_id in (select department_id from scope)
       and c.starts_at > now() - make_interval(days => (select d from win))
     group by grouping sets ((m.department_id), ())
  ),
  lines as (
    select d.id department_id, d.name, d.parent_id, false is_total from departments d where d.id in (select department_id from scope)
    union all select null, 'All', null, true where exists (select 1 from scope)
  ),
  joined as (
    select rw.department_id, rw.name, rw.parent_id, rw.is_total, a.n, a.eng, a.si, a.sent, a.enps, a.attr, a.prev_eng,
           coalesce(hc.n, 0) members_n, inv.total inv_total, inv.answered inv_answered,
           coalesce(a.n, 0) >= (select k from k) and coalesce(hc.n, 0) >= (select k from k)
             and coalesce(pk.peak, 0) >= (select k from k) ok,
           coalesce(a.prev_n, 0) >= (select k from k) and coalesce(hc.n, 0) >= (select k from k)
             and coalesce(pk.prev_peak, 0) >= (select k from k) prev_ok
      from lines rw
      left join agg a on a.is_total = rw.is_total and a.department_id is not distinct from rw.department_id
      left join peaks pk on pk.is_total = rw.is_total and pk.department_id is not distinct from rw.department_id
      left join headcount hc on hc.is_total = rw.is_total and hc.department_id is not distinct from rw.department_id
      left join invites inv on (inv.department_id is null) = rw.is_total and inv.department_id is not distinct from rw.department_id
  )
  select j.department_id, j.name, j.parent_id, j.members_n::int, coalesce(j.n, 0)::int, not j.ok,
         case when j.ok then round(j.eng, 1) end,
         case when j.ok then round(j.si, 1) end,
         case when j.ok then round(j.sent, 2) end,
         case when j.ok then j.enps end,
         case when j.ok then round(j.attr, 2) end,
         case when j.ok and j.prev_ok then round(j.prev_eng, 1) end,
         case when j.ok and j.inv_total >= (select k from k) then round(j.inv_answered::numeric / j.inv_total, 2) end,
         case when j.ok then coalesce((
           select jsonb_object_agg(t.theme, round(t.c::numeric / j.n, 2)) from themes t
            where t.kind = 'concern' and t.is_total = j.is_total and t.department_id is not distinct from j.department_id
              and (t.theme <> 'manager_support' or j.is_total or coalesce(
                    (select h.campaigns from history h where h.department_id = j.department_id), 0) >= 2)), '{}') end,
         case when j.ok then coalesce((
           select jsonb_object_agg(t.theme, round(t.c::numeric / j.n, 2)) from themes t
            where t.kind = 'strength' and t.is_total = j.is_total and t.department_id is not distinct from j.department_id), '{}') end
    from joined j
   order by j.is_total desc, j.name
$$;

/** Weekly trend (by check-in start week) for one department in scope, or the whole scope. Same people-based floor as insights_departments. */
create function public.insights_trend(p_department uuid default null, p_weeks int default 12)
returns table(week date, responses int, suppressed boolean, engagement numeric, score_index numeric, sentiment numeric, attrition_share numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare k int := insights_min_group(); headcount int;
begin
  if p_department is not null and p_department not in (select department_id from insights_scope()) then
    raise exception 'department not in scope';
  end if;
  select count(*) into headcount from org_members m
   where m.department_id in (select department_id from insights_scope())
     and (p_department is null or m.department_id = p_department);
  return query
  -- One point per check-in week (by campaign start), so a check-in answered over a weekend stays one point.
  with r as (
    select date_trunc('week', c.starts_at)::date wk, x.* from survey_responses x join survey_campaigns c on c.id = x.campaign_id
     where x.department_id in (select department_id from insights_scope())
       and (p_department is null or x.department_id = p_department)
       and x.response_day > current_date - 7 * greatest(1, least(coalesce(p_weeks, 12), 52))
  ), peak as (
    select c.wk, max(c.n) p from (select r.wk, r.campaign_id, count(*) n from r group by 1, 2) c group by 1
  ), w as (
    select r.wk, count(*) n, avg(r.engagement) eng, avg(r.score_index) si, avg(r.sentiment) sent,
           avg((cardinality(r.attrition_signals) > 0)::int) attr
      from r group by 1
  )
  select w.wk, w.n::int, not (w.n >= k and pk.p >= k and headcount >= k),
         case when w.n >= k and pk.p >= k and headcount >= k then round(w.eng, 1) end,
         case when w.n >= k and pk.p >= k and headcount >= k then round(w.si, 1) end,
         case when w.n >= k and pk.p >= k and headcount >= k then round(w.sent, 2) end,
         case when w.n >= k and pk.p >= k and headcount >= k then round(w.attr, 2) end
    from w join peak pk on pk.wk = w.wk order by w.wk;
end $$;

/** Before/after for each action in scope: engagement and the action's theme share, with the people-based floor on each side. */
create function public.insights_action_impact(p_days int default 28)
returns table(action_id uuid, before_responses int, after_responses int, before_engagement numeric, after_engagement numeric,
              before_theme_share numeric, after_theme_share numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with scope as (select department_id from insights_scope()),
  k as (select insights_min_group() k),
  acts as (
    select a.* from action_items a
     where a.department_id in (select department_id from scope)
        or (a.department_id is null and coach_my_role(a.org_id) in ('leader','hr'))
  ),
  s as (
    select a.id, r.campaign_id, r.response_day >= a.created_at::date is_after, r.engagement, (a.theme = any(r.concerns))::int has_theme
      from acts a join survey_responses r on r.org_id = a.org_id
       and r.department_id in (select department_id from scope)
       and (a.department_id is null or r.department_id = a.department_id)
       and r.response_day between a.created_at::date - greatest(1, least(coalesce(p_days, 28), 180))
                              and a.created_at::date + greatest(1, least(coalesce(p_days, 28), 180))
  ),
  peaks as (
    select id, max(n) filter (where not is_after) bp, max(n) filter (where is_after) ap
      from (select id, campaign_id, is_after, count(*) n from s group by 1, 2, 3) c group by id
  ),
  headcount as (
    select a.id, (select count(*) from org_members m where m.department_id in (select department_id from scope)
                    and (a.department_id is null or m.department_id = a.department_id)) n
      from acts a
  ),
  g as (
    select id, count(*) filter (where not is_after) bn, count(*) filter (where is_after) an,
           avg(engagement) filter (where not is_after) be, avg(engagement) filter (where is_after) ae,
           avg(has_theme) filter (where not is_after) bt, avg(has_theme) filter (where is_after) att
      from s group by id
  ),
  j as (
    select a.id, a.theme, g.bn, g.an, g.be, g.ae, g.bt, g.att,
           coalesce(g.bn, 0) >= (select k from k) and coalesce(p.bp, 0) >= (select k from k) and h.n >= (select k from k) b_ok,
           coalesce(g.an, 0) >= (select k from k) and coalesce(p.ap, 0) >= (select k from k) and h.n >= (select k from k) a_ok
      from acts a left join g on g.id = a.id left join peaks p on p.id = a.id join headcount h on h.id = a.id
  )
  select j.id, coalesce(j.bn, 0)::int, coalesce(j.an, 0)::int,
         case when j.b_ok then round(j.be, 1) end,
         case when j.a_ok then round(j.ae, 1) end,
         case when j.b_ok and j.theme is not null then round(j.bt, 2) end,
         case when j.a_ok and j.theme is not null then round(j.att, 2) end
    from j
$$;

/** Launches a campaign for the caller's scope and invites the audience. Managers: pulse for their own subtree only. */
create function public.insights_launch_campaign(p_kind text, p_title text, p_department_ids uuid[] default '{}', p_days int default 7)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare me org_members; cid uuid; audience uuid[];
begin
  select * into me from org_members where user_id = (select auth.uid());
  if not found or me.role not in ('manager','leader','hr') then raise exception 'not allowed'; end if;
  if p_kind not in ('engagement','pulse') then raise exception 'invalid kind'; end if;
  if me.role = 'manager' and p_kind <> 'pulse' then raise exception 'managers can launch pulse checks only'; end if;
  if exists (select 1 from unnest(coalesce(p_department_ids, '{}')) d where d not in (select department_id from insights_scope())) then
    raise exception 'department not in scope';
  end if;
  audience := case when coalesce(cardinality(p_department_ids), 0) = 0
                   then array(select department_id from insights_scope()) else p_department_ids end;
  insert into survey_campaigns(org_id, kind, title, questions, department_ids, ends_at, created_by)
  values (me.org_id, p_kind, left(coalesce(nullif(trim(p_title), ''), initcap(p_kind) || ' check'), 120),
          survey_default_questions(p_kind), audience, now() + make_interval(days => greatest(1, least(coalesce(p_days, 7), 60))),
          me.user_id)
  returning id into cid;
  insert into survey_invites(campaign_id, user_id)
  select cid, m.user_id from org_members m
   where m.org_id = me.org_id and m.department_id = any(audience)
     and coalesce((select p.surveys_enabled from coach_profiles p where p.user_id = m.user_id), true);
  return cid;
end $$;

create function public.insights_close_campaign(p_id uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update survey_campaigns c set status = 'closed', ends_at = least(coalesce(c.ends_at, now()), now())
   where c.id = p_id and c.status = 'live'
     and (c.created_by = (select auth.uid()) or exists (select 1 from org_members m where m.user_id = (select auth.uid())
                                                        and m.org_id = c.org_id and m.role in ('leader','hr')));
  return found;
end $$;

/** Creates or updates an action within the caller's scope. Org-wide (null department) needs leader/hr. */
create function public.insights_save_action(
  p_id uuid, p_department_id uuid, p_campaign_id uuid, p_theme text, p_title text, p_detail text, p_status text, p_published boolean
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare me org_members; aid uuid;
begin
  select * into me from org_members where user_id = (select auth.uid());
  if not found or me.role not in ('manager','leader','hr') then raise exception 'not allowed'; end if;
  if p_department_id is null and me.role = 'manager' then raise exception 'managers act on their own team'; end if;
  if p_department_id is not null and p_department_id not in (select department_id from insights_scope()) then
    raise exception 'department not in scope';
  end if;
  if p_id is null then
    insert into action_items(org_id, department_id, campaign_id, theme, title, detail, owner_user_id, status, published, published_at)
    values (me.org_id, p_department_id, p_campaign_id, p_theme, p_title, p_detail, me.user_id, coalesce(p_status, 'planned'),
            coalesce(p_published, false), case when p_published then now() end)
    returning id into aid;
  else
    update action_items a set department_id = p_department_id, theme = p_theme, title = p_title, detail = p_detail,
           status = coalesce(p_status, a.status), published = coalesce(p_published, a.published),
           published_at = case when coalesce(p_published, a.published) then coalesce(a.published_at, now()) end
     where a.id = p_id and a.org_id = me.org_id
       and (a.department_id in (select department_id from insights_scope()) or (a.department_id is null and me.role in ('leader','hr')))
    returning a.id into aid;
    if aid is null then raise exception 'action not in scope'; end if;
  end if;
  return aid;
end $$;

-- ---------------------------------------------------------------- worker claims (service role)
/** Leases due follow-ups (10-minute lease guards against a crashed worker). */
create function public.coach_claim_followups(p_limit int default 10, p_user uuid default null) returns setof public.coach_steps
language sql security definer set search_path = public, pg_temp as $$
  update coach_steps s set followup_status = 'calling', followup_claimed_at = now(), followup_attempts = s.followup_attempts + 1
   where s.id in (select id from coach_steps
                   where status = 'open' and (p_user is null or user_id = p_user)
                     and ((followup_status = 'scheduled' and followup_at <= now())
                       or (followup_status = 'calling' and followup_claimed_at < now() - interval '10 minutes'))
                   order by followup_at limit greatest(1, least(p_limit, 50)) for update skip locked)
  returning s.*
$$;

create function public.survey_claim_invites(p_limit int default 10) returns setof public.survey_invites
language sql security definer set search_path = public, pg_temp as $$
  update survey_invites i set status = 'calling', claimed_at = now(), attempts = i.attempts + 1, updated_at = now()
   where (i.campaign_id, i.user_id) in (
     select v.campaign_id, v.user_id from survey_invites v join survey_campaigns c on c.id = v.campaign_id
      where c.status = 'live' and (c.ends_at is null or c.ends_at > now())
        and ((v.status = 'pending' and v.next_attempt_at <= now())
          or (v.status = 'calling' and v.claimed_at < now() - interval '10 minutes'))
      order by v.next_attempt_at limit greatest(1, least(p_limit, 50)) for update of v skip locked)
  returning i.*
$$;

-- ---------------------------------------------------------------- function grants
revoke all on function public.insights_scope(), public.coach_my_departments(), public.coach_my_membership(), public.coach_my_role(uuid),
  public.coach_share_respond(uuid, text, text), public.coach_share_reject(uuid), public.coach_team_requests(),
  public.survey_default_questions(text),
  public.survey_record_response(uuid, uuid, jsonb, numeric, smallint, numeric, numeric, text[], text[], text[]),
  public.insights_departments(int), public.insights_trend(uuid, int), public.insights_action_impact(int),
  public.insights_launch_campaign(text, text, uuid[], int), public.insights_close_campaign(uuid),
  public.insights_save_action(uuid, uuid, uuid, text, text, text, text, boolean),
  public.coach_claim_followups(int, uuid), public.survey_claim_invites(int)
  from public, anon, authenticated;
grant execute on function public.insights_scope(), public.coach_my_departments(), public.coach_my_membership(), public.coach_my_role(uuid),
  public.coach_share_respond(uuid, text, text), public.coach_share_reject(uuid), public.coach_team_requests(),
  public.insights_departments(int), public.insights_trend(uuid, int), public.insights_action_impact(int),
  public.insights_launch_campaign(text, text, uuid[], int), public.insights_close_campaign(uuid),
  public.insights_save_action(uuid, uuid, uuid, text, text, text, text, boolean)
  to authenticated;
grant execute on function public.insights_scope(), public.coach_my_departments(), public.coach_my_membership(),
  public.survey_default_questions(text),
  public.survey_record_response(uuid, uuid, jsonb, numeric, smallint, numeric, numeric, text[], text[], text[]),
  public.insights_departments(int), public.insights_trend(uuid, int), public.insights_action_impact(int),
  public.coach_claim_followups(int, uuid), public.survey_claim_invites(int)
  to service_role;
