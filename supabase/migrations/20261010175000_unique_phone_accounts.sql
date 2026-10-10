-- Phone is a unique account lookup key, never a browser authentication secret.
create table public.account_phones (
  phone text primary key check (phone ~ '^\+359[89][0-9]{8}$'),
  user_id uuid not null unique references auth.users(id) on delete cascade
);
create table public.account_access_keys (
  hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('device','link')),
  expires_at timestamptz not null
);
alter table public.account_phones enable row level security;
alter table public.account_access_keys enable row level security;
revoke all on public.account_phones,public.account_access_keys from public,anon,authenticated;
grant all on public.account_phones,public.account_access_keys to service_role;
-- Prefer confirmed ownership; do not guess among unverified duplicates.
insert into public.account_phones(phone,user_id)
select '+'||regexp_replace(phone,'\D','','g'),id from auth.users
where phone_confirmed_at is not null and regexp_replace(phone,'\D','','g') ~ '^359[89][0-9]{8}$'
and deleted_at is null and raw_app_meta_data->>'merged_into' is null;
insert into public.account_phones(phone,user_id)
select '+'||digits,(array_agg(id))[1] from (
 select id,regexp_replace(raw_user_meta_data->>'contact_phone','\D','','g') digits
 from auth.users where deleted_at is null and raw_app_meta_data->>'merged_into' is null
) u where digits ~ '^359[89][0-9]{8}$' group by digits having count(*)=1
on conflict do nothing;
create function public.alo_register_phone() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare p text; existing text;
begin
 select phone into existing from account_phones where user_id=new.id;
 p := '+'||regexp_replace(coalesce(nullif(new.phone,''),new.raw_user_meta_data->>'contact_phone',''),'\D','','g');
 if existing is not null and p<>existing then raise exception 'Account phone cannot be changed without verification'; end if;
 if new.raw_app_meta_data->>'merged_into' is not null then return new; end if;
 if p ~ '^\+359[89][0-9]{8}$' then
   insert into account_phones(phone,user_id) values(p,new.id) on conflict(user_id) do nothing;
 end if;
 return new;
end $$;
create trigger alo_register_phone after insert or update of phone,raw_user_meta_data on auth.users for each row execute function public.alo_register_phone();
revoke all on function public.alo_register_phone() from public,anon,authenticated;
create function public.alo_redeem_access(p_hash text) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare k account_access_keys;
begin
 select * into k from account_access_keys where hash=p_hash and expires_at>now() for update;
 if not found then return null; end if;
 if k.kind='link' then delete from account_access_keys where hash=p_hash; end if;
 return k.user_id;
end $$;
revoke all on function public.alo_redeem_access(text) from public,anon,authenticated;
grant execute on function public.alo_redeem_access(text) to service_role;
-- Voice and browser resolve through the same mapping. No newest-account heuristic.
create or replace function public.nova_user_id_by_phone(p_phone text) returns uuid
language sql stable security definer set search_path=public,pg_temp as $$
 select user_id from account_phones where phone='+'||regexp_replace(p_phone,'\D','','g');
$$;
revoke all on function public.nova_user_id_by_phone(text) from public,anon,authenticated;
grant execute on function public.nova_user_id_by_phone(text) to service_role;
