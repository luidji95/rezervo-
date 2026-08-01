\set ON_ERROR_STOP on
begin;

do $$
declare
  v_def text;
  v_complete_def text;
  v_ledger_lock_pos integer;
  v_attempt_lock_pos integer;
  v_clock_pos integer;
begin
  if to_regprocedure('public.finalize_billing_checkout_recovery_v1(uuid,uuid,text,text,text,timestamptz)') is null then
    raise exception 'CHECKOUT_RECOVERY_FINALIZER_MISSING';
  end if;
  if to_regprocedure('public.finalize_billing_checkout_recovery_v1(uuid,uuid,text,text,text,timestamptz,timestamptz)') is not null then
    raise exception 'CHECKOUT_RECOVERY_FINALIZER_ACCEPTS_CALLER_TIME';
  end if;
  if has_function_privilege('public','public.finalize_billing_checkout_recovery_v1(uuid,uuid,text,text,text,timestamptz)','execute')
     or has_function_privilege('anon','public.finalize_billing_checkout_recovery_v1(uuid,uuid,text,text,text,timestamptz)','execute')
     or has_function_privilege('authenticated','public.finalize_billing_checkout_recovery_v1(uuid,uuid,text,text,text,timestamptz)','execute')
     or not has_function_privilege('service_role','public.finalize_billing_checkout_recovery_v1(uuid,uuid,text,text,text,timestamptz)','execute') then
    raise exception 'CHECKOUT_RECOVERY_FINALIZER_GRANTS_INVALID';
  end if;
  if has_function_privilege('public','public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz)','execute')
     or has_function_privilege('anon','public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz)','execute')
     or has_function_privilege('authenticated','public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz)','execute')
     or not has_function_privilege('service_role','public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz)','execute') then
    raise exception 'CHECKOUT_RECOVERY_COMPLETE_GRANTS_INVALID';
  end if;
  select pg_catalog.pg_get_functiondef('public.finalize_billing_checkout_recovery_v1(uuid,uuid,text,text,text,timestamptz)'::regprocedure)
    into v_def;
  select pg_catalog.pg_get_functiondef('public.complete_billing_checkout_recovery_attempt_v1(uuid,uuid,text,text,timestamptz)'::regprocedure)
    into v_complete_def;
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid='public.finalize_billing_checkout_recovery_v1(uuid,uuid,text,text,text,timestamptz)'::regprocedure
      and p.prosecdef and p.proconfig=array['search_path=""']
  ) then raise exception 'CHECKOUT_RECOVERY_FINALIZER_SECURITY_INVALID'; end if;
  v_ledger_lock_pos:=pg_catalog.strpos(v_def, 'select c.* into v_checkout');
  v_attempt_lock_pos:=pg_catalog.strpos(v_def, 'select a.* into v_attempt');
  v_clock_pos:=pg_catalog.strpos(v_def, 'v_now := pg_catalog.clock_timestamp()');
  if v_ledger_lock_pos=0 or v_attempt_lock_pos=0 or v_clock_pos=0
     or not (v_ledger_lock_pos < v_attempt_lock_pos and v_attempt_lock_pos < v_clock_pos)
     or pg_catalog.substr(v_def,v_ledger_lock_pos,v_attempt_lock_pos-v_ledger_lock_pos) not ilike '%for update%'
     or pg_catalog.substr(v_def,v_attempt_lock_pos,v_clock_pos-v_attempt_lock_pos) not ilike '%for update%'
     or v_def ilike '%update public.subscriptions%'
     or v_def ilike '%p_now%'
     or v_complete_def ilike '%p_outcome not in (%recovered_open%' then
    raise exception 'CHECKOUT_RECOVERY_FINALIZER_DEFINITION_INVALID';
  end if;
  if v_complete_def ilike '%''recovered_open''%' then
    raise exception 'GENERIC_COMPLETE_STILL_ACCEPTS_RECOVERED_OPEN';
  end if;
end;
$$;

create function pg_temp.make_recovery_fixture(
  p_salon uuid,
  p_owner uuid,
  p_plan uuid,
  p_environment text,
  p_ledger_status text,
  p_provider_session_id text,
  p_attempt_status text,
  p_attempt_outcome text,
  p_lease_delta interval
)
returns table(checkout_id uuid, attempt_id uuid, claim_token uuid)
language plpgsql
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  checkout_id := extensions.gen_random_uuid();
  attempt_id := extensions.gen_random_uuid();
  claim_token := extensions.gen_random_uuid();
  insert into public.billing_checkout_sessions(
    id,salon_id,actor_profile_id,requested_plan_id,provider,environment,
    provider_session_id,idempotency_key,status,expires_at,created_at,updated_at,
    completed_at,failed_at
  ) values (
    checkout_id,p_salon,p_owner,p_plan,'lemonsqueezy',p_environment,
    p_provider_session_id,extensions.gen_random_uuid(),p_ledger_status,v_now+interval '1 hour',v_now,v_now,
    case when p_ledger_status='completed' then v_now else null end,
    case when p_ledger_status='failed' then v_now else null end
  );
  insert into public.billing_checkout_recovery_attempts(
    id,checkout_session_id,provider,environment,status,outcome,claim_token,
    claimed_at,lease_expires_at,completed_at,attempt_number,created_at,updated_at
  ) values (
    attempt_id,checkout_id,'lemonsqueezy',p_environment,p_attempt_status,p_attempt_outcome,claim_token,
    v_now-interval '1 minute',v_now+p_lease_delta,
    case
      when p_attempt_status='completed' then v_now-interval '1 second'
      when p_attempt_status='abandoned' then v_now
      else null
    end,
    1,v_now-interval '1 minute',
    case when p_attempt_status='claimed' then v_now-interval '1 minute' else v_now end
  );
  return next;
end;
$$;

do $$
declare
  v_owner uuid:=extensions.gen_random_uuid();
  v_salon uuid:=extensions.gen_random_uuid();
  v_plan uuid;
  v_subscription uuid;
  v_fixture record;
  v_other record;
  v_result record;
  v_before text;
  v_after text;
  v_subscription_before text;
  v_subscription_after text;
  v_attempt_before text;
  v_attempt_after text;
  v_hash text:=repeat('a',64);
  v_hash_2 text:=repeat('b',64);
  v_expiry timestamptz:=pg_catalog.clock_timestamp()+interval '30 minutes';
  v_rejected boolean;
  v_status text;
  v_nonfinite timestamptz;
begin
  select id into v_plan from public.plans where slug='pro';
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(v_owner,v_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values(v_salon,v_owner,'Recovery finalization contract','recovery-finalize-'||substr(v_salon::text,1,8));
  select id into v_subscription from public.subscriptions where salon_id=v_salon;
  if v_subscription is null then raise exception 'FINALIZATION_SUBSCRIPTION_FIXTURE_MISSING'; end if;

  -- Stable argument validation must happen before any mutation.
  foreach v_status in array array['', '0', '-1', '1.5', 'abc', '70000000-0000-4000-8000-000000000001'] loop
    v_rejected:=false;
    begin
      perform * from public.finalize_billing_checkout_recovery_v1(
        extensions.gen_random_uuid(),extensions.gen_random_uuid(),'test',v_status,v_hash,v_expiry);
    exception when sqlstate '22023' then
      v_rejected:=sqlerrm='BILLING_CHECKOUT_RECOVERY_FINALIZATION_PROVIDER_ID_INVALID';
    end;
    if not v_rejected then raise exception 'INVALID_PROVIDER_ID_ALLOWED:%',v_status; end if;
  end loop;
  v_rejected:=false;
  begin perform * from public.finalize_billing_checkout_recovery_v1(
    extensions.gen_random_uuid(),extensions.gen_random_uuid(),'test','7001','ABC',v_expiry);
  exception when sqlstate '22023' then v_rejected:=sqlerrm='BILLING_CHECKOUT_RECOVERY_FINALIZATION_URL_HASH_INVALID'; end;
  if not v_rejected then raise exception 'INVALID_URL_HASH_ALLOWED'; end if;
  v_rejected:=false;
  begin perform * from public.finalize_billing_checkout_recovery_v1(
    extensions.gen_random_uuid(),extensions.gen_random_uuid(),'test','7001',v_hash,null);
  exception when sqlstate '22004' then v_rejected:=sqlerrm='BILLING_CHECKOUT_RECOVERY_FINALIZATION_EXPIRY_REQUIRED'; end;
  if not v_rejected then raise exception 'NULL_EXPIRY_ALLOWED'; end if;

  select * into v_fixture from pg_temp.make_recovery_fixture(
    v_salon,v_owner,v_plan,'test','creating',null,'claimed',null,interval '10 minutes');
  foreach v_nonfinite in array array['infinity'::timestamptz,'-infinity'::timestamptz] loop
    select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_before
    from public.billing_checkout_sessions c where c.id=v_fixture.checkout_id;
    select pg_catalog.md5(pg_catalog.row_to_json(a)::text) into v_attempt_before
    from public.billing_checkout_recovery_attempts a where a.id=v_fixture.attempt_id;
    v_rejected:=false;
    begin perform * from public.finalize_billing_checkout_recovery_v1(
      v_fixture.attempt_id,v_fixture.claim_token,'test','7002',v_hash,v_nonfinite);
    exception when sqlstate '22023' then
      v_rejected:=sqlerrm='BILLING_CHECKOUT_RECOVERY_FINALIZATION_EXPIRY_INVALID';
    end;
    select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_after
    from public.billing_checkout_sessions c where c.id=v_fixture.checkout_id;
    select pg_catalog.md5(pg_catalog.row_to_json(a)::text) into v_attempt_after
    from public.billing_checkout_recovery_attempts a where a.id=v_fixture.attempt_id;
    if not v_rejected or v_before is distinct from v_after or v_attempt_before is distinct from v_attempt_after then
      raise exception 'NONFINITE_EXPIRY_CONTRACT_INVALID';
    end if;
  end loop;

  -- Generic audit completion can no longer forge finalization proof.
  select * into v_fixture from pg_temp.make_recovery_fixture(
    v_salon,v_owner,v_plan,'test','creating',null,'claimed',null,interval '10 minutes');
  v_rejected:=false;
  begin perform * from public.complete_billing_checkout_recovery_attempt_v1(
    v_fixture.attempt_id,v_fixture.claim_token,'test','recovered_open',pg_catalog.clock_timestamp());
  exception when sqlstate '22023' then v_rejected:=sqlerrm='BILLING_CHECKOUT_RECOVERY_OUTCOME_INVALID'; end;
  if not v_rejected then raise exception 'GENERIC_COMPLETE_RECOVERED_OPEN_ALLOWED'; end if;

  -- Successful atomic finalization and exact replay.
  select * into v_fixture from pg_temp.make_recovery_fixture(
    v_salon,v_owner,v_plan,'test','creating',null,'claimed',null,interval '10 minutes');
  update public.billing_checkout_sessions
  set provider_order_id='preserved-order', resulting_subscription_id=v_subscription
  where id=v_fixture.checkout_id;
  select pg_catalog.md5(pg_catalog.row_to_json(s)::text) into v_subscription_before
  from public.subscriptions s where id=v_subscription;
  select * into v_result from public.finalize_billing_checkout_recovery_v1(
    v_fixture.attempt_id,v_fixture.claim_token,'test','7101',v_hash,v_expiry);
  if v_result.finalization_outcome<>'finalized' or v_result.ledger_status<>'open'
     or v_result.attempt_status<>'completed' or v_result.audit_outcome<>'recovered_open'
     or v_result.attempt_completed_at is null then raise exception 'FINALIZATION_SUCCESS_INVALID'; end if;
  if not exists(
    select 1 from public.billing_checkout_sessions c
    where c.id=v_fixture.checkout_id and c.status='open' and c.provider_session_id='7101'
      and c.checkout_url_hash=v_hash and c.expires_at=v_expiry and c.error_code is null
      and c.failed_at is null and c.completed_at is null
      and c.provider_order_id='preserved-order' and c.resulting_subscription_id=v_subscription
  ) then raise exception 'FINALIZATION_LEDGER_VALUES_INVALID'; end if;
  if not exists(
    select 1 from public.billing_checkout_recovery_attempts a
    where a.id=v_fixture.attempt_id and a.status='completed' and a.outcome='recovered_open'
  ) then raise exception 'FINALIZATION_AUDIT_INVALID'; end if;
  select pg_catalog.md5(pg_catalog.row_to_json(s)::text) into v_subscription_after
  from public.subscriptions s where id=v_subscription;
  if v_subscription_before is distinct from v_subscription_after then raise exception 'FINALIZATION_MUTATED_SUBSCRIPTION'; end if;

  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_before
  from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  select * into v_result from public.finalize_billing_checkout_recovery_v1(
    v_fixture.attempt_id,v_fixture.claim_token,'test','7101',v_hash,v_expiry);
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_after
  from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  if v_result.finalization_outcome<>'already_finalized' or v_before is distinct from v_after then
    raise exception 'IDENTICAL_REPLAY_INVALID';
  end if;
  for v_status in select value from (values('id'),('hash'),('expiry')) x(value) loop
    select * into v_result from public.finalize_billing_checkout_recovery_v1(
      v_fixture.attempt_id,v_fixture.claim_token,'test',
      case when v_status='id' then '7102' else '7101' end,
      case when v_status='hash' then v_hash_2 else v_hash end,
      case when v_status='expiry' then v_expiry+interval '1 minute' else v_expiry end);
    if v_result.finalization_outcome<>'finalization_conflict' then raise exception 'REPLAY_CONFLICT_NOT_DETECTED:%',v_status; end if;
  end loop;

  -- Missing, wrong-token and environment mismatch never mutate.
  select * into v_result from public.finalize_billing_checkout_recovery_v1(
    extensions.gen_random_uuid(),extensions.gen_random_uuid(),'test','7201',v_hash,v_expiry);
  if v_result.finalization_outcome<>'claim_lost' then raise exception 'MISSING_ATTEMPT_NOT_CLAIM_LOST'; end if;
  select * into v_fixture from pg_temp.make_recovery_fixture(
    v_salon,v_owner,v_plan,'test','creating',null,'claimed',null,interval '10 minutes');
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_before from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  select pg_catalog.md5(pg_catalog.row_to_json(a)::text) into v_attempt_before from public.billing_checkout_recovery_attempts a where id=v_fixture.attempt_id;
  select * into v_result from public.finalize_billing_checkout_recovery_v1(
    v_fixture.attempt_id,extensions.gen_random_uuid(),'test','7202',v_hash,v_expiry);
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_after from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  select pg_catalog.md5(pg_catalog.row_to_json(a)::text) into v_attempt_after from public.billing_checkout_recovery_attempts a where id=v_fixture.attempt_id;
  if v_result.finalization_outcome<>'claim_lost' or v_before is distinct from v_after
     or v_attempt_before is distinct from v_attempt_after then raise exception 'WRONG_TOKEN_MUTATED'; end if;
  select * into v_result from public.finalize_billing_checkout_recovery_v1(
    v_fixture.attempt_id,v_fixture.claim_token,'live','7202',v_hash,v_expiry);
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_after from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  select pg_catalog.md5(pg_catalog.row_to_json(a)::text) into v_attempt_after from public.billing_checkout_recovery_attempts a where id=v_fixture.attempt_id;
  if v_result.finalization_outcome<>'claim_lost' or v_before is distinct from v_after
     or v_attempt_before is distinct from v_attempt_after then raise exception 'ENVIRONMENT_MISMATCH_MUTATED'; end if;

  -- A creating ledger with any existing provider ID is a manual-review conflict.
  select * into v_fixture from pg_temp.make_recovery_fixture(
    v_salon,v_owner,v_plan,'test','creating','7251','claimed',null,interval '10 minutes');
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_before from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  select * into v_result from public.finalize_billing_checkout_recovery_v1(
    v_fixture.attempt_id,v_fixture.claim_token,'test','7251',v_hash,v_expiry);
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_after from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  if v_result.finalization_outcome<>'ledger_state_conflict' or v_result.attempt_status<>'completed'
     or v_result.audit_outcome<>'manual_review' or v_before is distinct from v_after then
    raise exception 'CREATING_WITH_PROVIDER_ID_CONFLICT_INVALID';
  end if;

  -- Completed non-finalization and abandoned attempts are deterministic.
  select * into v_fixture from pg_temp.make_recovery_fixture(
    v_salon,v_owner,v_plan,'test','creating',null,'completed','still_pending',interval '10 minutes');
  select * into v_result from public.finalize_billing_checkout_recovery_v1(
    v_fixture.attempt_id,v_fixture.claim_token,'test','7301',v_hash,v_expiry);
  if v_result.finalization_outcome<>'attempt_state_conflict' or v_result.audit_outcome<>'still_pending' then
    raise exception 'COMPLETED_NON_RECOVERED_INVALID'; end if;
  select * into v_fixture from pg_temp.make_recovery_fixture(
    v_salon,v_owner,v_plan,'test','creating',null,'abandoned','claim_lost',interval '-1 second');
  select * into v_result from public.finalize_billing_checkout_recovery_v1(
    v_fixture.attempt_id,v_fixture.claim_token,'test','7302',v_hash,v_expiry);
  if v_result.finalization_outcome<>'claim_lost' or v_result.attempt_status<>'abandoned' then raise exception 'ABANDONED_INVALID'; end if;

  -- Expired active lease and expired provider checkout have distinct audits.
  select * into v_fixture from pg_temp.make_recovery_fixture(
    v_salon,v_owner,v_plan,'test','creating',null,'claimed',null,interval '-1 second');
  select * into v_result from public.finalize_billing_checkout_recovery_v1(
    v_fixture.attempt_id,v_fixture.claim_token,'test','7401',v_hash,v_expiry);
  if v_result.finalization_outcome<>'claim_lost' or v_result.attempt_status<>'abandoned' or v_result.audit_outcome<>'claim_lost' then
    raise exception 'EXPIRED_LEASE_INVALID'; end if;
  select * into v_fixture from pg_temp.make_recovery_fixture(
    v_salon,v_owner,v_plan,'test','creating',null,'claimed',null,interval '10 minutes');
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_before from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  select * into v_result from public.finalize_billing_checkout_recovery_v1(
    v_fixture.attempt_id,v_fixture.claim_token,'test','7402',v_hash,pg_catalog.clock_timestamp()-interval '1 second');
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_after from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  if v_result.finalization_outcome<>'provider_checkout_expired' or v_result.attempt_status<>'completed'
     or v_result.audit_outcome<>'invalid_candidate' or v_before is distinct from v_after then
    raise exception 'EXPIRED_PROVIDER_INVALID'; end if;

  -- Provider ID collision completes audit/manual_review without ledger mutation.
  select * into v_other from pg_temp.make_recovery_fixture(
    v_salon,v_owner,v_plan,'test','open','7501','completed','still_pending',interval '10 minutes');
  select * into v_fixture from pg_temp.make_recovery_fixture(
    v_salon,v_owner,v_plan,'test','creating',null,'claimed',null,interval '10 minutes');
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_before from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  select * into v_result from public.finalize_billing_checkout_recovery_v1(
    v_fixture.attempt_id,v_fixture.claim_token,'test','7501',v_hash,v_expiry);
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_after from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  if v_result.finalization_outcome<>'provider_id_conflict' or v_result.audit_outcome<>'manual_review'
     or v_result.attempt_status<>'completed' or v_before is distinct from v_after then
    raise exception 'PROVIDER_ID_CONFLICT_INVALID'; end if;

  -- Every forbidden ledger state completes a valid claim as manual review.
  foreach v_status in array array['open','completed','failed','cancelled','expired'] loop
    select * into v_fixture from pg_temp.make_recovery_fixture(
      v_salon,v_owner,v_plan,'test',v_status,
      case when v_status in ('open','completed') then null else null end,
      'claimed',null,interval '10 minutes');
    select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_before from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
    select * into v_result from public.finalize_billing_checkout_recovery_v1(
      v_fixture.attempt_id,v_fixture.claim_token,'test','760'||array_position(array['open','completed','failed','cancelled','expired'],v_status),v_hash,v_expiry);
    select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_after from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
    if v_result.finalization_outcome<>'ledger_state_conflict' or v_result.attempt_status<>'completed'
       or v_result.audit_outcome<>'manual_review' or v_before is distinct from v_after then
      raise exception 'LEDGER_STATE_CONFLICT_INVALID:%',v_status;
    end if;
  end loop;
end;
$$;

-- A failure during the second guarded update must roll back the ledger update.
create function pg_temp.reject_recovered_open_test()
returns trigger language plpgsql as $$
begin
  if new.outcome='recovered_open' then raise exception 'TEST_SECOND_UPDATE_FAILURE'; end if;
  return new;
end;
$$;
create trigger billing_checkout_recovery_test_second_update_failure
before update on public.billing_checkout_recovery_attempts
for each row execute function pg_temp.reject_recovered_open_test();

do $$
declare
  v_owner uuid:=extensions.gen_random_uuid();
  v_salon uuid:=extensions.gen_random_uuid();
  v_plan uuid;
  v_fixture record;
  v_before text;
  v_after text;
  v_rejected boolean:=false;
begin
  select id into v_plan from public.plans where slug='starter';
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(v_owner,v_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values(v_salon,v_owner,'Recovery rollback contract','recovery-rollback-'||substr(v_salon::text,1,8));
  select * into v_fixture from pg_temp.make_recovery_fixture(
    v_salon,v_owner,v_plan,'test','creating',null,'claimed',null,interval '10 minutes');
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_before
  from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  begin
    perform * from public.finalize_billing_checkout_recovery_v1(
      v_fixture.attempt_id,v_fixture.claim_token,'test','7901',repeat('c',64),pg_catalog.clock_timestamp()+interval '30 minutes');
  exception when raise_exception then v_rejected:=sqlerrm='TEST_SECOND_UPDATE_FAILURE'; end;
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_after
  from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  if not v_rejected or v_before is distinct from v_after
     or not exists(select 1 from public.billing_checkout_recovery_attempts a where a.id=v_fixture.attempt_id and a.status='claimed') then
    raise exception 'SECOND_UPDATE_FAILURE_DID_NOT_ROLLBACK';
  end if;
end;
$$;

drop trigger billing_checkout_recovery_test_second_update_failure on public.billing_checkout_recovery_attempts;

-- An unrelated unique violation must propagate and must never become provider_id_conflict.
create function pg_temp.reject_with_unrelated_unique_test()
returns trigger language plpgsql as $$
begin
  if new.outcome='recovered_open' then
    raise unique_violation using constraint='synthetic_unrelated_unique_constraint';
  end if;
  return new;
end;
$$;
create trigger billing_checkout_recovery_test_unrelated_unique
before update on public.billing_checkout_recovery_attempts
for each row execute function pg_temp.reject_with_unrelated_unique_test();

do $$
declare
  v_owner uuid:=extensions.gen_random_uuid();
  v_salon uuid:=extensions.gen_random_uuid();
  v_plan uuid;
  v_fixture record;
  v_before text;
  v_after text;
  v_attempt_before text;
  v_attempt_after text;
  v_constraint_name text;
  v_rejected boolean:=false;
begin
  select id into v_plan from public.plans where slug='starter';
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(v_owner,v_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values(v_salon,v_owner,'Recovery unrelated unique contract','recovery-unique-'||substr(v_salon::text,1,8));
  select * into v_fixture from pg_temp.make_recovery_fixture(
    v_salon,v_owner,v_plan,'test','creating',null,'claimed',null,interval '10 minutes');
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_before
  from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  select pg_catalog.md5(pg_catalog.row_to_json(a)::text) into v_attempt_before
  from public.billing_checkout_recovery_attempts a where id=v_fixture.attempt_id;
  begin
    perform * from public.finalize_billing_checkout_recovery_v1(
      v_fixture.attempt_id,v_fixture.claim_token,'test','7951',repeat('e',64),pg_catalog.clock_timestamp()+interval '30 minutes');
  exception when unique_violation then
    get stacked diagnostics v_constraint_name=constraint_name;
    v_rejected:=v_constraint_name='synthetic_unrelated_unique_constraint';
  end;
  select pg_catalog.md5(pg_catalog.row_to_json(c)::text) into v_after
  from public.billing_checkout_sessions c where id=v_fixture.checkout_id;
  select pg_catalog.md5(pg_catalog.row_to_json(a)::text) into v_attempt_after
  from public.billing_checkout_recovery_attempts a where id=v_fixture.attempt_id;
  if not v_rejected or v_before is distinct from v_after or v_attempt_before is distinct from v_attempt_after
     or not exists(select 1 from public.billing_checkout_recovery_attempts a
       where a.id=v_fixture.attempt_id and a.status='claimed' and a.outcome is null) then
    raise exception 'UNRELATED_UNIQUE_VIOLATION_WAS_MISCLASSIFIED';
  end if;
end;
$$;

drop trigger billing_checkout_recovery_test_unrelated_unique on public.billing_checkout_recovery_attempts;

rollback;
