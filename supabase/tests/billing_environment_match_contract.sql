begin;

do $$
declare
  v_function regprocedure := 'public.billing_environment_matches_v1(text)'::regprocedure;
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = v_function and p.provolatile = 's' and p.prosecdef
      and p.proowner = 'postgres'::regrole
      and p.proconfig = array['search_path=""']::text[]
  ) then raise exception 'ENVIRONMENT_MATCH_METADATA_INVALID'; end if;
  if pg_catalog.has_function_privilege('anon', v_function, 'execute')
     or pg_catalog.has_function_privilege('authenticated', v_function, 'execute')
     or not pg_catalog.has_function_privilege('service_role', v_function, 'execute') then
    raise exception 'ENVIRONMENT_MATCH_ACL_INVALID';
  end if;
end;
$$;

delete from private.billing_runtime_config;
set local role service_role;
do $$ begin
  if public.billing_environment_matches_v1('test') is distinct from false then
    raise exception 'MISSING_CONFIG_MUST_FAIL_CLOSED';
  end if;
end $$;
reset role;

insert into private.billing_runtime_config(singleton, environment) values (true, 'test');
set local role service_role;
do $$ begin
  if public.billing_environment_matches_v1('test') is distinct from true
     or public.billing_environment_matches_v1('live') is distinct from false
     or public.billing_environment_matches_v1(null) is distinct from false
     or public.billing_environment_matches_v1('TEST') is distinct from false then
    raise exception 'TEST_ENVIRONMENT_MATCH_FAILED';
  end if;
end $$;
reset role;

update private.billing_runtime_config set environment = 'live';
set local role service_role;
do $$ begin
  if public.billing_environment_matches_v1('live') is distinct from true
     or public.billing_environment_matches_v1('test') is distinct from false then
    raise exception 'LIVE_ENVIRONMENT_MATCH_FAILED';
  end if;
end $$;
reset role;
rollback;

-- The RPC must execute in a read-only transaction as the application role.
begin read only;
set local role service_role;
select public.billing_environment_matches_v1('test');
rollback;
