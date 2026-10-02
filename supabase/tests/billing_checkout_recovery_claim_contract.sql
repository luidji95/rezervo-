\set ON_ERROR_STOP on
begin;

do $$
declare
  v_claim_def text;
  v_complete_def text;
begin
  if to_regclass('public.billing_checkout_recovery_attempts') is null then
    raise exception 'CHECKOUT_RECOVERY_ATTEMPTS_TABLE_MISSING';
  end if;
  if to_regprocedure('public.claim_billing_checkout_recovery_v1(uuid,text,timestamptz,interval)') is null
     or to_regprocedure('public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz)') is null then
    raise exception 'CHECKOUT_RECOVERY_RPC_MISSING';
  end if;
  if not (select relrowsecurity from pg_catalog.pg_class where oid='public.billing_checkout_recovery_attempts'::regclass) then
    raise exception 'CHECKOUT_RECOVERY_RLS_DISABLED';
  end if;
  if has_table_privilege('public','public.billing_checkout_recovery_attempts','select,insert,update,delete')
     or has_table_privilege('anon','public.billing_checkout_recovery_attempts','select,insert,update,delete')
     or has_table_privilege('authenticated','public.billing_checkout_recovery_attempts','select,insert,update,delete')
     or has_table_privilege('service_role','public.billing_checkout_recovery_attempts','insert,update,delete')
     or not has_table_privilege('service_role','public.billing_checkout_recovery_attempts','select') then
    raise exception 'CHECKOUT_RECOVERY_TABLE_GRANTS_INVALID';
  end if;
  if has_function_privilege('public','public.claim_billing_checkout_recovery_v1(uuid,text,timestamptz,interval)','execute')
     or has_function_privilege('anon','public.claim_billing_checkout_recovery_v1(uuid,text,timestamptz,interval)','execute')
     or has_function_privilege('authenticated','public.claim_billing_checkout_recovery_v1(uuid,text,timestamptz,interval)','execute')
     or not has_function_privilege('service_role','public.claim_billing_checkout_recovery_v1(uuid,text,timestamptz,interval)','execute')
     or has_function_privilege('public','public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz)','execute')
     or has_function_privilege('anon','public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz)','execute')
     or has_function_privilege('authenticated','public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz)','execute')
     or not has_function_privilege('service_role','public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz)','execute') then
    raise exception 'CHECKOUT_RECOVERY_RPC_GRANTS_INVALID';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='claim_billing_checkout_recovery_v1'
      and p.prosecdef and p.proconfig = array['search_path=""']
  ) or not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='complete_billing_checkout_recovery_attempt_v1'
      and p.prosecdef and p.proconfig = array['search_path=""']
  ) then raise exception 'CHECKOUT_RECOVERY_RPC_SECURITY_INVALID'; end if;
  if not exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname='public' and indexname='billing_checkout_recovery_attempts_active_unique'
      and indexdef ilike '%WHERE (status = ''claimed''::text)%'
  ) then raise exception 'CHECKOUT_RECOVERY_ACTIVE_UNIQUE_MISSING'; end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid='public.billing_checkout_recovery_attempts'::regclass
      and conname='billing_checkout_recovery_attempts_checkout_session_id_fkey'
      and pg_get_constraintdef(oid) ilike '%ON DELETE RESTRICT%'
  ) then raise exception 'CHECKOUT_RECOVERY_FK_INVALID'; end if;

  select pg_get_functiondef('public.claim_billing_checkout_recovery_v1(uuid,text,timestamptz,interval)'::regprocedure)
    into v_claim_def;
  select pg_get_functiondef('public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz)'::regprocedure)
    into v_complete_def;
  if v_claim_def not ilike '%FOR UPDATE%'
     or v_claim_def not ilike '%extensions.gen_random_uuid()%'
     or v_claim_def ilike '%update public.billing_checkout_sessions%'
     or v_claim_def ilike '%update public.subscriptions%'
     or v_complete_def ilike '%update public.billing_checkout_sessions%'
     or v_complete_def ilike '%update public.subscriptions%' then
    raise exception 'CHECKOUT_RECOVERY_MUTATION_BOUNDARY_INVALID';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  v_reached_function boolean:=false;
  v_completion text;
begin
  begin
    perform * from public.claim_billing_checkout_recovery_v1(
      '00000000-0000-4000-8000-000000000000','test','2026-07-31T10:00:00Z','5 minutes');
  exception when sqlstate 'P0002' then
    v_reached_function:=sqlerrm='BILLING_CHECKOUT_RECOVERY_CHECKOUT_NOT_FOUND';
  end;
  if not v_reached_function then raise exception 'SERVICE_ROLE_CLAIM_EXECUTION_FAILED'; end if;
  select completion_outcome into v_completion
  from public.complete_billing_checkout_recovery_attempt_v1(
    extensions.gen_random_uuid(),extensions.gen_random_uuid(),'test','still_pending','2026-07-31T10:00:00Z');
  if v_completion<>'claim_lost' then raise exception 'SERVICE_ROLE_COMPLETE_EXECUTION_FAILED'; end if;
end;
$$;
reset role;

do $$
declare
  v_owner uuid:=extensions.gen_random_uuid();
  v_salon uuid:=extensions.gen_random_uuid();
  v_plan uuid;
  v_checkout uuid:=extensions.gen_random_uuid();
  v_token uuid:=extensions.gen_random_uuid();
  v_rejected boolean;
begin
  select id into v_plan from public.plans where slug='starter';
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(v_owner,v_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values(v_salon,v_owner,'Recovery state constraints','recovery-state-'||substr(v_salon::text,1,8));
  insert into public.billing_checkout_sessions(
    id,salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,status
  ) values(v_checkout,v_salon,v_owner,v_plan,'lemonsqueezy','test',extensions.gen_random_uuid(),'creating');

  insert into public.billing_checkout_recovery_attempts(
    checkout_session_id,provider,environment,status,outcome,claim_token,claimed_at,lease_expires_at,
    completed_at,attempt_number,created_at,updated_at
  ) values
    (v_checkout,'lemonsqueezy','test','completed','still_pending',extensions.gen_random_uuid(),
      '2026-07-31T10:00:00Z','2026-07-31T10:05:00Z','2026-07-31T10:04:59Z',1,
      '2026-07-31T10:00:00Z','2026-07-31T10:04:59Z'),
    (v_checkout,'lemonsqueezy','test','abandoned','claim_lost',extensions.gen_random_uuid(),
      '2026-07-31T11:00:00Z','2026-07-31T11:05:00Z','2026-07-31T11:05:00Z',2,
      '2026-07-31T11:00:00Z','2026-07-31T11:05:00Z'),
    (v_checkout,'lemonsqueezy','test','claimed',null,v_token,
      '2026-07-31T12:00:00Z','2026-07-31T12:05:00Z',null,3,
      '2026-07-31T12:00:00Z','2026-07-31T12:00:00Z');

  v_rejected:=false;
  begin
    insert into public.billing_checkout_recovery_attempts(
      checkout_session_id,provider,environment,status,outcome,claim_token,claimed_at,lease_expires_at,completed_at,attempt_number,created_at,updated_at
    ) values(v_checkout,'lemonsqueezy','test','completed','claim_lost',extensions.gen_random_uuid(),
      '2026-07-31T13:00:00Z','2026-07-31T13:05:00Z','2026-07-31T13:04:00Z',4,'2026-07-31T13:00:00Z','2026-07-31T13:04:00Z');
  exception when check_violation then v_rejected:=true; end;
  if not v_rejected then raise exception 'COMPLETED_CLAIM_LOST_ALLOWED'; end if;

  v_rejected:=false;
  begin
    insert into public.billing_checkout_recovery_attempts(
      checkout_session_id,provider,environment,status,outcome,claim_token,claimed_at,lease_expires_at,completed_at,attempt_number,created_at,updated_at
    ) values(v_checkout,'lemonsqueezy','test','completed','still_pending',extensions.gen_random_uuid(),
      '2026-07-31T13:00:00Z','2026-07-31T13:05:00Z','2026-07-31T13:05:00Z',4,'2026-07-31T13:00:00Z','2026-07-31T13:05:00Z');
  exception when check_violation then v_rejected:=true; end;
  if not v_rejected then raise exception 'COMPLETED_AT_LEASE_BOUNDARY_ALLOWED'; end if;

  v_rejected:=false;
  begin
    insert into public.billing_checkout_recovery_attempts(
      checkout_session_id,provider,environment,status,outcome,claim_token,claimed_at,lease_expires_at,completed_at,attempt_number,created_at,updated_at
    ) values(v_checkout,'lemonsqueezy','test','completed','still_pending',extensions.gen_random_uuid(),
      '2026-07-31T13:00:00Z','2026-07-31T13:05:00Z','2026-07-31T13:05:01Z',4,'2026-07-31T13:00:00Z','2026-07-31T13:05:01Z');
  exception when check_violation then v_rejected:=true; end;
  if not v_rejected then raise exception 'COMPLETED_AFTER_LEASE_ALLOWED'; end if;

  v_rejected:=false;
  begin
    insert into public.billing_checkout_recovery_attempts(
      checkout_session_id,provider,environment,status,outcome,claim_token,claimed_at,lease_expires_at,completed_at,attempt_number,created_at,updated_at
    ) values(v_checkout,'lemonsqueezy','test','abandoned','claim_lost',extensions.gen_random_uuid(),
      '2026-07-31T13:00:00Z','2026-07-31T13:05:00Z','2026-07-31T13:04:59Z',4,'2026-07-31T13:00:00Z','2026-07-31T13:04:59Z');
  exception when check_violation then v_rejected:=true; end;
  if not v_rejected then raise exception 'ABANDONED_BEFORE_LEASE_ALLOWED'; end if;

  v_rejected:=false;
  begin
    insert into public.billing_checkout_recovery_attempts(
      checkout_session_id,provider,environment,status,outcome,claim_token,claimed_at,lease_expires_at,completed_at,attempt_number,created_at,updated_at
    ) values(v_checkout,'lemonsqueezy','test','abandoned','manual_review',extensions.gen_random_uuid(),
      '2026-07-31T13:00:00Z','2026-07-31T13:05:00Z','2026-07-31T13:05:00Z',4,'2026-07-31T13:00:00Z','2026-07-31T13:05:00Z');
  exception when check_violation then v_rejected:=true; end;
  if not v_rejected then raise exception 'ABANDONED_NON_CLAIM_LOST_ALLOWED'; end if;
end;
$$;

do $$
declare
  v_owner uuid := extensions.gen_random_uuid();
  v_open_owner uuid := extensions.gen_random_uuid();
  v_salon uuid := extensions.gen_random_uuid();
  v_open_salon uuid := extensions.gen_random_uuid();
  v_plan uuid;
  v_subscription uuid;
  v_test_checkout uuid := extensions.gen_random_uuid();
  v_live_checkout uuid := extensions.gen_random_uuid();
  v_open_checkout uuid := extensions.gen_random_uuid();
  v_completed_checkout uuid := extensions.gen_random_uuid();
  v_failed_checkout uuid := extensions.gen_random_uuid();
  v_expired_checkout uuid := extensions.gen_random_uuid();
  v_cancelled_checkout uuid := extensions.gen_random_uuid();
  v_claim record;
  v_second record;
  v_live_claim record;
  v_new_claim record;
  v_completion record;
  v_checkout_before text;
  v_checkout_after text;
  v_subscription_before text;
  v_subscription_after text;
  v_abandoned_completed_at timestamptz;
  v_abandoned_updated_at timestamptz;
  v_rejected boolean;
begin
  select id into v_plan from public.plans where slug='pro';
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values
    (v_owner,v_owner||'@example.invalid','{}','{}'),
    (v_open_owner,v_open_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values
    (v_salon,v_owner,'Checkout recovery contract','checkout-recovery-'||substr(v_salon::text,1,8)),
    (v_open_salon,v_open_owner,'Open recovery contract','checkout-recovery-open-'||substr(v_open_salon::text,1,8));
  if (select count(*) from public.subscriptions where salon_id=v_salon)<>1 then
    raise exception 'RECOVERY_FIXTURE_SUBSCRIPTION_COUNT_INVALID';
  end if;
  select id into v_subscription from public.subscriptions where salon_id=v_salon;
  if v_subscription is null then raise exception 'RECOVERY_FIXTURE_SUBSCRIPTION_MISSING'; end if;

  insert into public.billing_checkout_sessions(
    id,salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,status,
    provider_session_id,expires_at,created_at,updated_at,completed_at,failed_at
  ) values
    (v_test_checkout,v_salon,v_owner,v_plan,'lemonsqueezy','test',extensions.gen_random_uuid(),'creating',null,'2026-07-31T11:00:00Z','2026-07-31T10:00:00Z','2026-07-31T10:00:00Z',null,null),
    (v_live_checkout,v_salon,v_owner,v_plan,'lemonsqueezy','live',extensions.gen_random_uuid(),'creating','9002','2026-07-31T11:00:00Z','2026-07-31T10:00:00Z','2026-07-31T10:00:00Z',null,null),
    (v_open_checkout,v_open_salon,v_open_owner,v_plan,'lemonsqueezy','test',extensions.gen_random_uuid(),'open','9003','2026-07-31T11:00:00Z','2026-07-31T10:00:00Z','2026-07-31T10:00:00Z',null,null),
    (v_completed_checkout,v_salon,v_owner,v_plan,'lemonsqueezy','test',extensions.gen_random_uuid(),'completed','9004','2026-07-31T11:00:00Z','2026-07-31T10:00:00Z','2026-07-31T10:05:00Z','2026-07-31T10:05:00Z',null),
    (v_failed_checkout,v_salon,v_owner,v_plan,'lemonsqueezy','test',extensions.gen_random_uuid(),'failed',null,'2026-07-31T11:00:00Z','2026-07-31T10:00:00Z','2026-07-31T10:05:00Z',null,'2026-07-31T10:05:00Z'),
    (v_expired_checkout,v_salon,v_owner,v_plan,'lemonsqueezy','test',extensions.gen_random_uuid(),'expired','9005','2026-07-31T10:05:00Z','2026-07-31T09:00:00Z','2026-07-31T10:05:00Z',null,null),
    (v_cancelled_checkout,v_salon,v_owner,v_plan,'lemonsqueezy','test',extensions.gen_random_uuid(),'cancelled','9006','2026-07-31T11:00:00Z','2026-07-31T10:00:00Z','2026-07-31T10:05:00Z',null,null);

  select md5(coalesce(string_agg(row_to_json(c)::text,'|' order by c.id),'')) into v_checkout_before
  from public.billing_checkout_sessions c where c.salon_id=v_salon;
  select md5(row_to_json(s)::text) into v_subscription_before
  from public.subscriptions s where s.id=v_subscription;
  if v_subscription_before is null then raise exception 'SUBSCRIPTION_BEFORE_SNAPSHOT_MISSING'; end if;

  select * into v_claim from public.claim_billing_checkout_recovery_v1(
    v_test_checkout,'test','2026-07-31T10:10:00Z','5 minutes');
  if v_claim.claim_outcome<>'claimed' or v_claim.recovery_attempt_id is null
     or v_claim.claim_token is null or v_claim.attempt_number<>1
     or v_claim.checkout_session_id<>v_test_checkout or v_claim.environment<>'test'
     or v_claim.provider<>'lemonsqueezy' or v_claim.ledger_status<>'creating'
     or v_claim.lease_expires_at<>'2026-07-31T10:15:00Z' then
    raise exception 'TEST_CREATING_CLAIM_INVALID';
  end if;

  select * into v_second from public.claim_billing_checkout_recovery_v1(
    v_test_checkout,'test','2026-07-31T10:11:00Z','5 minutes');
  if v_second.claim_outcome<>'already_claimed' or v_second.recovery_attempt_id is not null
     or v_second.claim_token is not null or (select count(*) from public.billing_checkout_recovery_attempts
       where checkout_session_id=v_test_checkout and status='claimed')<>1 then
    raise exception 'ACTIVE_CLAIM_NOT_EXCLUSIVE';
  end if;

  select * into v_live_claim from public.claim_billing_checkout_recovery_v1(
    v_live_checkout,'live','2026-07-31T10:10:00Z','5 minutes');
  if v_live_claim.claim_outcome<>'claimed' or v_live_claim.environment<>'live' or v_live_claim.attempt_number<>1 then
    raise exception 'LIVE_CREATING_CLAIM_INVALID';
  end if;

  v_rejected:=false;
  begin perform * from public.claim_billing_checkout_recovery_v1(v_test_checkout,'live','2026-07-31T10:11:00Z','5 minutes');
  exception when sqlstate '22023' then v_rejected:=sqlerrm='BILLING_CHECKOUT_RECOVERY_ENVIRONMENT_MISMATCH'; end;
  if not v_rejected then raise exception 'TEST_LIVE_MISMATCH_ALLOWED'; end if;
  v_rejected:=false;
  begin perform * from public.claim_billing_checkout_recovery_v1(v_live_checkout,'test','2026-07-31T10:11:00Z','5 minutes');
  exception when sqlstate '22023' then v_rejected:=sqlerrm='BILLING_CHECKOUT_RECOVERY_ENVIRONMENT_MISMATCH'; end;
  if not v_rejected then raise exception 'LIVE_TEST_MISMATCH_ALLOWED'; end if;
  v_rejected:=false;
  begin perform * from public.claim_billing_checkout_recovery_v1(extensions.gen_random_uuid(),'test','2026-07-31T10:11:00Z','5 minutes');
  exception when sqlstate 'P0002' then v_rejected:=sqlerrm='BILLING_CHECKOUT_RECOVERY_CHECKOUT_NOT_FOUND'; end;
  if not v_rejected then raise exception 'MISSING_CHECKOUT_ALLOWED'; end if;

  select * into v_second from public.claim_billing_checkout_recovery_v1(v_open_checkout,'test','2026-07-31T10:10:00Z','5 minutes');
  if v_second.claim_outcome<>'already_open' or v_second.recovery_attempt_id is not null then raise exception 'OPEN_ELIGIBILITY_INVALID'; end if;
  select * into v_second from public.claim_billing_checkout_recovery_v1(v_completed_checkout,'test','2026-07-31T10:10:00Z','5 minutes');
  if v_second.claim_outcome<>'already_completed' or v_second.recovery_attempt_id is not null then raise exception 'COMPLETED_ELIGIBILITY_INVALID'; end if;
  select * into v_second from public.claim_billing_checkout_recovery_v1(v_failed_checkout,'test','2026-07-31T10:10:00Z','5 minutes');
  if v_second.claim_outcome<>'manual_review' or v_second.recovery_attempt_id is not null then raise exception 'TERMINAL_ELIGIBILITY_INVALID'; end if;
  select * into v_second from public.claim_billing_checkout_recovery_v1(v_expired_checkout,'test','2026-07-31T10:10:00Z','5 minutes');
  if v_second.claim_outcome<>'manual_review' or v_second.recovery_attempt_id is not null then raise exception 'EXPIRED_ELIGIBILITY_INVALID'; end if;
  select * into v_second from public.claim_billing_checkout_recovery_v1(v_cancelled_checkout,'test','2026-07-31T10:10:00Z','5 minutes');
  if v_second.claim_outcome<>'manual_review' or v_second.recovery_attempt_id is not null then raise exception 'CANCELLED_ELIGIBILITY_INVALID'; end if;

  select * into v_completion from public.complete_billing_checkout_recovery_attempt_v1(
    v_claim.recovery_attempt_id,v_claim.claim_token,'test','still_pending','2026-07-31T10:12:00Z');
  if v_completion.completion_outcome<>'completed' or v_completion.status<>'completed'
     or v_completion.outcome<>'still_pending' then raise exception 'VALID_COMPLETION_FAILED'; end if;
  select * into v_completion from public.complete_billing_checkout_recovery_attempt_v1(
    v_claim.recovery_attempt_id,v_claim.claim_token,'test','still_pending','2026-07-31T10:12:01Z');
  if v_completion.completion_outcome<>'already_completed' then raise exception 'IDEMPOTENT_COMPLETION_FAILED'; end if;
  v_rejected:=false;
  begin perform * from public.complete_billing_checkout_recovery_attempt_v1(
    v_claim.recovery_attempt_id,v_claim.claim_token,'test','provider_not_found','2026-07-31T10:12:02Z');
  exception when sqlstate '22023' then v_rejected:=sqlerrm='BILLING_CHECKOUT_RECOVERY_OUTCOME_CONFLICT'; end;
  if not v_rejected then raise exception 'COMPLETED_OUTCOME_CHANGED'; end if;
  v_rejected:=false;
  begin perform * from public.complete_billing_checkout_recovery_attempt_v1(
    v_claim.recovery_attempt_id,v_claim.claim_token,'test','arbitrary','2026-07-31T10:12:02Z');
  exception when sqlstate '22023' then v_rejected:=sqlerrm='BILLING_CHECKOUT_RECOVERY_OUTCOME_INVALID'; end;
  if not v_rejected then raise exception 'ARBITRARY_OUTCOME_ALLOWED'; end if;

  select * into v_second from public.claim_billing_checkout_recovery_v1(
    v_test_checkout,'test','2026-07-31T10:13:00Z','1 minute');
  if v_second.attempt_number<>2 then raise exception 'SECOND_ATTEMPT_NUMBER_INVALID'; end if;
  select * into v_completion from public.complete_billing_checkout_recovery_attempt_v1(
    v_second.recovery_attempt_id,v_second.claim_token,'test','still_pending','2026-07-31T10:14:00Z');
  if v_completion.completion_outcome<>'claim_lost' or not exists(
    select 1 from public.billing_checkout_recovery_attempts
    where id=v_second.recovery_attempt_id and status='abandoned' and outcome='claim_lost'
  ) then raise exception 'EXPIRED_LEASE_COMPLETION_ALLOWED'; end if;
  v_abandoned_completed_at:=v_completion.completed_at;
  select updated_at into v_abandoned_updated_at
  from public.billing_checkout_recovery_attempts where id=v_second.recovery_attempt_id;
  select * into v_completion from public.complete_billing_checkout_recovery_attempt_v1(
    v_second.recovery_attempt_id,v_second.claim_token,'test','still_pending','2026-07-31T10:14:01Z');
  if v_completion.completion_outcome<>'claim_lost'
     or v_completion.status<>'abandoned'
     or v_completion.outcome<>'claim_lost'
     or v_completion.completed_at is distinct from v_abandoned_completed_at
     or (select updated_at from public.billing_checkout_recovery_attempts where id=v_second.recovery_attempt_id)
       is distinct from v_abandoned_updated_at then
    raise exception 'ABANDONED_COMPLETION_REPLAY_UNSTABLE';
  end if;

  select * into v_new_claim from public.claim_billing_checkout_recovery_v1(
    v_test_checkout,'test','2026-07-31T10:14:02Z','5 minutes');
  if v_new_claim.attempt_number<>3 or v_new_claim.claim_token=v_second.claim_token then raise exception 'LEASE_RECOVERY_INVALID'; end if;
  select * into v_completion from public.complete_billing_checkout_recovery_attempt_v1(
    v_new_claim.recovery_attempt_id,v_second.claim_token,'test','still_pending','2026-07-31T10:14:02Z');
  if v_completion.completion_outcome<>'claim_lost' or not exists(
    select 1 from public.billing_checkout_recovery_attempts where id=v_new_claim.recovery_attempt_id and status='claimed'
  ) then raise exception 'STALE_TOKEN_FINISHED_NEW_ATTEMPT'; end if;

  select md5(coalesce(string_agg(row_to_json(c)::text,'|' order by c.id),'')) into v_checkout_after
  from public.billing_checkout_sessions c where c.salon_id=v_salon;
  select md5(row_to_json(s)::text) into v_subscription_after
  from public.subscriptions s where s.id=v_subscription;
  if v_subscription_after is null then raise exception 'SUBSCRIPTION_AFTER_SNAPSHOT_MISSING'; end if;
  if v_checkout_before<>v_checkout_after then raise exception 'CHECKOUT_LEDGER_MUTATED'; end if;
  if v_subscription_before is distinct from v_subscription_after then raise exception 'SUBSCRIPTION_MUTATED'; end if;
end;
$$;

alter table public.billing_checkout_sessions drop constraint billing_checkout_sessions_provider_check;

do $$
declare
  v_owner uuid:=extensions.gen_random_uuid();
  v_salon uuid:=extensions.gen_random_uuid();
  v_plan uuid;
  v_checkout uuid:=extensions.gen_random_uuid();
  v_rejected boolean:=false;
begin
  select id into v_plan from public.plans where slug='starter';
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(v_owner,v_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values(v_salon,v_owner,'Unsupported provider recovery','unsupported-recovery-'||substr(v_salon::text,1,8));
  insert into public.billing_checkout_sessions(
    id,salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,status
  ) values(v_checkout,v_salon,v_owner,v_plan,'other_provider','test',extensions.gen_random_uuid(),'creating');
  begin perform * from public.claim_billing_checkout_recovery_v1(v_checkout,'test','2026-07-31T10:00:00Z','5 minutes');
  exception when sqlstate '22023' then v_rejected:=sqlerrm='BILLING_CHECKOUT_RECOVERY_PROVIDER_UNSUPPORTED'; end;
  if not v_rejected then raise exception 'UNSUPPORTED_PROVIDER_ALLOWED'; end if;
end;
$$;

rollback;
