begin;
insert into auth.users(id) values ('d87bb065-3f44-4677-bd43-000000000001'),('d87bb065-3f44-4677-bd43-000000000002');
insert into public.profiles(id,name) values ('d87bb065-3f44-4677-bd43-000000000001','Test A'),('d87bb065-3f44-4677-bd43-000000000002','Test B');
insert into public.connections(user_id,service) select id,'gmail' from public.profiles where name in ('Test A','Test B');
insert into public.activity(user_id,type,title) select id,'task','{"en":"RLS test","bg":"RLS тест"}'::jsonb from public.profiles where name in ('Test A','Test B');
set local role authenticated;
select set_config('request.jwt.claim.sub','d87bb065-3f44-4677-bd43-000000000001',true);
do $$ begin
 if (select count(*) from public.profiles) <> 1 then raise exception 'Profile isolation failed'; end if;
 if (select count(*) from public.connections) <> 1 then raise exception 'Connection isolation failed'; end if;
 if (select count(*) from public.activity) <> 1 then raise exception 'Activity isolation failed'; end if;
 update public.profiles set name='Cross-user write' where id='d87bb065-3f44-4677-bd43-000000000002';
 if found then raise exception 'Cross-user update succeeded'; end if;
 begin
  update public.profiles set id='d87bb065-3f44-4677-bd43-000000000003';
  raise exception 'Owner reassignment succeeded';
 exception when insufficient_privilege then null;
 end;
 if has_table_privilege('authenticated','public.provider_tokens','SELECT') then raise exception 'Tokens exposed'; end if;
 if has_table_privilege('authenticated','public.oauth_states','SELECT') then raise exception 'OAuth state exposed'; end if;
 if has_table_privilege('authenticated','public.agent_state','SELECT') then raise exception 'Agent state exposed'; end if;
 if has_table_privilege('authenticated','public.connections','INSERT') then raise exception 'Connection forgery possible'; end if;
 if has_table_privilege('authenticated','public.activity','INSERT') then raise exception 'Activity forgery possible'; end if;
 if has_table_privilege('anon','public.profiles','SELECT') then raise exception 'Anonymous profile access'; end if;
end $$;
reset role;
select 'PASS: owner isolation, forged writes, private credentials and anonymous access' as result;
rollback;
