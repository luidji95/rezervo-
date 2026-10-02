begin;

create or replace function pg_temp.assert_true(p_value boolean, p_message text)
returns void language plpgsql as $$
begin
  if not coalesce(p_value, false) then
    raise exception '%', p_message;
  end if;
end;
$$;

do $$
declare
  v_index_definition text;
  v_function_definition text;
  v_argument_names text[];
  v_security_definer boolean;
  v_config text[];
begin
  select pg_catalog.pg_get_indexdef(i.indexrelid),
         pg_catalog.pg_get_expr(i.indpred, i.indrelid)
    into v_index_definition, v_function_definition
  from pg_catalog.pg_index i
  where i.indexrelid = 'public.billing_checkout_sessions_active_intent_unique'::regclass;

  perform pg_temp.assert_true(v_index_definition ilike '%unique index billing_checkout_sessions_active_intent_unique%provider, environment, salon_id%', 'ACTIVE_INTENT_INDEX_COLUMNS_INVALID');
  perform pg_temp.assert_true(v_function_definition ilike '%status%creating%open%', 'ACTIVE_INTENT_INDEX_PREDICATE_INVALID');

  select p.proargnames, p.prosecdef, p.proconfig
    into v_argument_names, v_security_definer, v_config
  from pg_catalog.pg_proc p
  where p.oid = 'public.acquire_billing_checkout_intent_v1(uuid,uuid,uuid,text,text)'::regprocedure;
  perform pg_temp.assert_true(
    v_argument_names = array[
      'p_salon_id','p_actor_profile_id','p_requested_plan_id','p_provider','p_environment',
      'acquisition_outcome','checkout_session_id','idempotency_key','status','requested_plan_id',
      'actor_profile_id','provider','environment','provider_session_id','expires_at'
    ],
    'ACTIVE_INTENT_RPC_ARGUMENTS_INVALID'
  );
  perform pg_temp.assert_true(not ('p_checkout_session_id' = any(v_argument_names)), 'CALLER_LEDGER_ID_ACCEPTED');
  perform pg_temp.assert_true(not ('p_idempotency_key' = any(v_argument_names)), 'CALLER_IDEMPOTENCY_KEY_ACCEPTED');

  perform pg_temp.assert_true(v_security_definer, 'ACTIVE_INTENT_RPC_NOT_SECURITY_DEFINER');
  perform pg_temp.assert_true(v_config = array['search_path=""'], 'ACTIVE_INTENT_RPC_SEARCH_PATH_NOT_EMPTY');

  select pg_catalog.pg_get_functiondef('public.acquire_billing_checkout_intent_v1(uuid,uuid,uuid,text,text)'::regprocedure)
    into v_function_definition;
  perform pg_temp.assert_true(v_function_definition ilike '%on conflict (provider, environment, salon_id)%where status in (%creating%, %open%)%do nothing%', 'ACTIVE_INTENT_PARTIAL_CONFLICT_TARGET_MISSING');
  perform pg_temp.assert_true(v_function_definition ilike '%for update%', 'ACTIVE_INTENT_EXISTING_ROW_NOT_LOCKED');
  perform pg_temp.assert_true(v_function_definition ilike '%pg_advisory_xact_lock%clock_timestamp()%update public.billing_checkout_sessions%', 'EXPIRED_OPEN_CLOCK_NOT_AFTER_ADVISORY_LOCK');
  perform pg_temp.assert_true(v_function_definition ilike '%c.status = %open%%c.expires_at is not null%c.expires_at <= v_now%', 'EXPIRED_OPEN_GUARD_INVALID');
end;
$$;

do $$
declare
  v_owner_one uuid := extensions.gen_random_uuid();
  v_owner_two uuid := extensions.gen_random_uuid();
  v_salon_one uuid := extensions.gen_random_uuid();
  v_salon_two uuid := extensions.gen_random_uuid();
  v_starter uuid;
  v_pro uuid;
  v_first record;
  v_repeat record;
  v_other_plan record;
  v_other_actor record;
  v_after_terminal record;
  v_live record;
  v_other_salon record;
  v_rejected boolean;
  v_original_plan uuid;
  v_original_actor uuid;
begin
  select id into strict v_starter from public.plans where slug = 'starter';
  select id into strict v_pro from public.plans where slug = 'pro';

  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values
    (v_owner_one, v_owner_one || '@example.invalid', '{}', '{}'),
    (v_owner_two, v_owner_two || '@example.invalid', '{}', '{}');
  insert into public.salons(id,owner_id,name,slug)
  values
    (v_salon_one,v_owner_one,'Active intent one','active-intent-' || replace(v_salon_one::text,'-','')),
    (v_salon_two,v_owner_two,'Active intent two','active-intent-' || replace(v_salon_two::text,'-',''));

  select * into strict v_first
  from public.acquire_billing_checkout_intent_v1(v_salon_one,v_owner_one,v_starter,'lemonsqueezy','test');
  perform pg_temp.assert_true(v_first.acquisition_outcome = 'created', 'FIRST_ACQUIRE_NOT_CREATED');
  perform pg_temp.assert_true(v_first.status = 'creating', 'FIRST_ACQUIRE_STATUS_INVALID');
  perform pg_temp.assert_true(v_first.checkout_session_id is not null and v_first.idempotency_key is not null, 'DATABASE_IDS_NOT_GENERATED');

  select * into strict v_repeat
  from public.acquire_billing_checkout_intent_v1(v_salon_one,v_owner_one,v_starter,'lemonsqueezy','test');
  perform pg_temp.assert_true(v_repeat.acquisition_outcome = 'existing', 'REPEAT_ACQUIRE_NOT_EXISTING');
  perform pg_temp.assert_true(v_repeat.checkout_session_id = v_first.checkout_session_id and v_repeat.idempotency_key = v_first.idempotency_key, 'REPEAT_ACQUIRE_IDENTITY_CHANGED');

  select * into strict v_other_plan
  from public.acquire_billing_checkout_intent_v1(v_salon_one,v_owner_one,v_pro,'lemonsqueezy','test');
  perform pg_temp.assert_true(v_other_plan.acquisition_outcome = 'existing', 'OTHER_PLAN_DID_NOT_COLLIDE');
  perform pg_temp.assert_true(v_other_plan.checkout_session_id = v_first.checkout_session_id and v_other_plan.requested_plan_id = v_starter, 'OTHER_PLAN_MUTATED_ACTIVE_INTENT');

  select requested_plan_id, actor_profile_id into v_original_plan, v_original_actor
  from public.billing_checkout_sessions where id = v_first.checkout_session_id;
  select * into strict v_other_actor
  from public.acquire_billing_checkout_intent_v1(v_salon_one,v_owner_two,v_pro,'lemonsqueezy','test');
  perform pg_temp.assert_true(v_other_actor.acquisition_outcome = 'existing', 'OTHER_ACTOR_DID_NOT_REUSE_ACTIVE_INTENT');
  perform pg_temp.assert_true(v_other_actor.actor_profile_id = v_original_actor and v_other_actor.requested_plan_id = v_original_plan, 'OTHER_ACTOR_MUTATED_ACTIVE_INTENT');

  perform pg_temp.assert_true((select count(*) = 1 from public.billing_checkout_sessions where salon_id = v_salon_one and provider = 'lemonsqueezy' and environment = 'test' and status in ('creating','open')), 'MULTIPLE_ACTIVE_INTENTS_CREATED');

  v_rejected := false;
  begin
    insert into public.billing_checkout_sessions(
      salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,status
    ) values (
      v_salon_one,v_owner_one,v_pro,'lemonsqueezy','test',extensions.gen_random_uuid(),'open'
    );
  exception when unique_violation then
    v_rejected := true;
  end;
  perform pg_temp.assert_true(v_rejected, 'DIRECT_SECOND_ACTIVE_INTENT_ALLOWED');

  update public.billing_checkout_sessions
  set status = 'failed', failed_at = pg_catalog.clock_timestamp(), error_code = 'fixture_terminal'
  where id = v_first.checkout_session_id and status = 'creating';
  select * into strict v_after_terminal
  from public.acquire_billing_checkout_intent_v1(v_salon_one,v_owner_one,v_pro,'lemonsqueezy','test');
  perform pg_temp.assert_true(v_after_terminal.acquisition_outcome = 'created' and v_after_terminal.checkout_session_id <> v_first.checkout_session_id, 'TERMINAL_INTENT_DID_NOT_RELEASE_SCOPE');
  perform pg_temp.assert_true(v_after_terminal.requested_plan_id = v_pro, 'NEW_INTENT_PLAN_INVALID');

  select * into strict v_live
  from public.acquire_billing_checkout_intent_v1(v_salon_one,v_owner_one,v_starter,'lemonsqueezy','live');
  perform pg_temp.assert_true(v_live.acquisition_outcome = 'created' and v_live.environment = 'live', 'ENVIRONMENT_SCOPE_NOT_ISOLATED');

  select * into strict v_other_salon
  from public.acquire_billing_checkout_intent_v1(v_salon_two,v_owner_two,v_starter,'lemonsqueezy','test');
  perform pg_temp.assert_true(v_other_salon.acquisition_outcome = 'created' and v_other_salon.checkout_session_id <> v_after_terminal.checkout_session_id, 'SALON_SCOPE_NOT_ISOLATED');

  v_rejected := false;
  begin
    perform * from public.acquire_billing_checkout_intent_v1(v_salon_two,v_owner_two,v_starter,'stripe','test');
  exception when sqlstate '22023' then
    v_rejected := sqlerrm = 'BILLING_CHECKOUT_INTENT_PROVIDER_INVALID';
  end;
  perform pg_temp.assert_true(v_rejected, 'UNSUPPORTED_PROVIDER_ACCEPTED');
end;
$$;

do $$
declare
  v_owner uuid;
  v_starter uuid;
  v_salon uuid;
  v_old record;
  v_acquired record;
  v_old_status text;
  v_old_updated_at timestamptz;
  v_case integer;
begin
  select id into strict v_starter from public.plans where slug = 'starter';
  for v_case in 1..9 loop
    v_owner := extensions.gen_random_uuid();
    v_salon := extensions.gen_random_uuid();
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
    values(v_owner, v_owner || '@example.invalid', '{}', '{}');
    insert into public.salons(id,owner_id,name,slug)
    values(v_salon,v_owner,'Expiry case ' || v_case,'expiry-case-' || replace(v_salon::text,'-',''));

    select * into strict v_old
    from public.acquire_billing_checkout_intent_v1(v_salon,v_owner,v_starter,'lemonsqueezy','test');

    if v_case = 1 then
      update public.billing_checkout_sessions
      set status='open', provider_session_id=extensions.gen_random_uuid()::text,
          expires_at=pg_catalog.clock_timestamp()-interval '1 second',
          updated_at=pg_catalog.clock_timestamp()-interval '1 minute'
      where id=v_old.checkout_session_id;
      select * into strict v_acquired
      from public.acquire_billing_checkout_intent_v1(v_salon,v_owner,v_starter,'lemonsqueezy','test');
      select status,updated_at into v_old_status,v_old_updated_at from public.billing_checkout_sessions where id=v_old.checkout_session_id;
      perform pg_temp.assert_true(v_old_status='expired' and v_old_updated_at is not null, 'EXPIRED_OPEN_NOT_TERMINALIZED');
      perform pg_temp.assert_true(v_acquired.acquisition_outcome='created' and v_acquired.checkout_session_id<>v_old.checkout_session_id, 'EXPIRED_OPEN_NOT_REPLACED');
      select * into strict v_acquired from public.acquire_billing_checkout_intent_v1(v_salon,v_owner,v_starter,'lemonsqueezy','test');
      perform pg_temp.assert_true(v_acquired.acquisition_outcome='existing', 'EXPIRED_OPEN_REPLACEMENT_NOT_REUSED');
    elsif v_case = 2 then
      update public.billing_checkout_sessions set status='open',expires_at=pg_catalog.clock_timestamp()+interval '1 hour' where id=v_old.checkout_session_id;
      select * into strict v_acquired from public.acquire_billing_checkout_intent_v1(v_salon,v_owner,v_starter,'lemonsqueezy','test');
      perform pg_temp.assert_true(v_acquired.acquisition_outcome='existing' and v_acquired.checkout_session_id=v_old.checkout_session_id and v_acquired.status='open', 'FUTURE_OPEN_REPLACED');
    elsif v_case = 3 then
      update public.billing_checkout_sessions set status='open',expires_at=null where id=v_old.checkout_session_id;
      select * into strict v_acquired from public.acquire_billing_checkout_intent_v1(v_salon,v_owner,v_starter,'lemonsqueezy','test');
      perform pg_temp.assert_true(v_acquired.acquisition_outcome='existing' and v_acquired.checkout_session_id=v_old.checkout_session_id and v_acquired.status='open', 'NULL_EXPIRY_OPEN_REPLACED');
    elsif v_case = 4 then
      update public.billing_checkout_sessions set expires_at=pg_catalog.clock_timestamp()-interval '1 hour' where id=v_old.checkout_session_id;
      select * into strict v_acquired from public.acquire_billing_checkout_intent_v1(v_salon,v_owner,v_starter,'lemonsqueezy','test');
      perform pg_temp.assert_true(v_acquired.acquisition_outcome='existing' and v_acquired.checkout_session_id=v_old.checkout_session_id and v_acquired.status='creating', 'CREATING_INTENT_EXPIRED');
    elsif v_case = 5 then
      update public.billing_checkout_sessions set status='completed',completed_at=pg_catalog.clock_timestamp(),expires_at=pg_catalog.clock_timestamp()-interval '1 hour' where id=v_old.checkout_session_id;
      select * into strict v_acquired from public.acquire_billing_checkout_intent_v1(v_salon,v_owner,v_starter,'lemonsqueezy','test');
      select status into v_old_status from public.billing_checkout_sessions where id=v_old.checkout_session_id;
      perform pg_temp.assert_true(v_old_status='completed' and v_acquired.acquisition_outcome='created', 'COMPLETED_STATE_OVERWRITTEN');
    elsif v_case = 6 then
      update public.billing_checkout_sessions set status='failed',failed_at=pg_catalog.clock_timestamp(),error_code='fixture_failed',expires_at=pg_catalog.clock_timestamp()-interval '1 hour' where id=v_old.checkout_session_id;
      select * into strict v_acquired from public.acquire_billing_checkout_intent_v1(v_salon,v_owner,v_starter,'lemonsqueezy','test');
      select status into v_old_status from public.billing_checkout_sessions where id=v_old.checkout_session_id;
      perform pg_temp.assert_true(v_old_status='failed' and v_acquired.acquisition_outcome='created', 'FAILED_STATE_OVERWRITTEN');
    elsif v_case = 7 then
      update public.billing_checkout_sessions set status='expired',expires_at=pg_catalog.clock_timestamp()-interval '1 hour' where id=v_old.checkout_session_id;
      select * into strict v_acquired from public.acquire_billing_checkout_intent_v1(v_salon,v_owner,v_starter,'lemonsqueezy','test');
      select status into v_old_status from public.billing_checkout_sessions where id=v_old.checkout_session_id;
      perform pg_temp.assert_true(v_old_status='expired' and v_acquired.acquisition_outcome='created', 'EXPIRED_STATE_OVERWRITTEN');
    elsif v_case = 8 then
      update public.billing_checkout_sessions set status='cancelled',expires_at=pg_catalog.clock_timestamp()-interval '1 hour' where id=v_old.checkout_session_id;
      select * into strict v_acquired from public.acquire_billing_checkout_intent_v1(v_salon,v_owner,v_starter,'lemonsqueezy','test');
      select status into v_old_status from public.billing_checkout_sessions where id=v_old.checkout_session_id;
      perform pg_temp.assert_true(v_old_status='cancelled' and v_acquired.acquisition_outcome='created', 'CANCELLED_STATE_OVERWRITTEN');
    else
      update public.billing_checkout_sessions set status='open',expires_at=pg_catalog.clock_timestamp() where id=v_old.checkout_session_id;
      select * into strict v_acquired from public.acquire_billing_checkout_intent_v1(v_salon,v_owner,v_starter,'lemonsqueezy','test');
      select status into v_old_status from public.billing_checkout_sessions where id=v_old.checkout_session_id;
      perform pg_temp.assert_true(v_old_status='expired' and v_acquired.acquisition_outcome='created', 'DB_NOW_BOUNDARY_NOT_EXPIRED');
    end if;

    perform pg_temp.assert_true(
      (select count(*)=1 from public.billing_checkout_sessions where salon_id=v_salon and provider='lemonsqueezy' and environment='test' and status in ('creating','open')),
      'EXPIRY_CASE_ACTIVE_SCOPE_INVALID'
    );
  end loop;
end;
$$;

do $$
begin
  perform pg_temp.assert_true(has_function_privilege('service_role','public.acquire_billing_checkout_intent_v1(uuid,uuid,uuid,text,text)','execute'), 'SERVICE_ROLE_EXECUTE_MISSING');
  perform pg_temp.assert_true(not has_function_privilege('anon','public.acquire_billing_checkout_intent_v1(uuid,uuid,uuid,text,text)','execute'), 'ANON_EXECUTE_ALLOWED');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','public.acquire_billing_checkout_intent_v1(uuid,uuid,uuid,text,text)','execute'), 'AUTHENTICATED_EXECUTE_ALLOWED');
  perform pg_temp.assert_true(not has_function_privilege('public','public.acquire_billing_checkout_intent_v1(uuid,uuid,uuid,text,text)','execute'), 'PUBLIC_EXECUTE_ALLOWED');
end;
$$;

rollback;
