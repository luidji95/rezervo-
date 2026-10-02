begin;

create or replace function pg_temp.assert_true(p_value boolean,p_message text)
returns void language plpgsql as $$ begin
  if not coalesce(p_value,false) then raise exception '%',p_message; end if;
end $$;

create or replace function pg_temp.assert_blocked(
  p_salon uuid,p_actor uuid,p_plan uuid,p_expected text
) returns void language plpgsql as $$
declare v_message text; begin
  begin
    perform * from public.acquire_billing_checkout_intent_v2(p_salon,p_actor,p_plan,'lemonsqueezy');
    raise exception 'EXPECTED_BLOCK_%',p_expected;
  exception when others then
    get stacked diagnostics v_message=message_text;
    if v_message is distinct from p_expected then
      raise exception 'WRONG_BLOCK expected %, got %',p_expected,v_message;
    end if;
  end;
  perform pg_temp.assert_true(
    (select count(*)=0 from public.billing_checkout_sessions c
      where c.salon_id=p_salon and c.status in ('creating','open')),
    'BLOCKED_ACQUIRE_LEFT_ACTIVE_LEDGER'
  );
end $$;

insert into private.billing_runtime_config(singleton,environment) values(true,'test');

do $$
declare
  v_definition text; v_args text[]; v_owner uuid; v_salon uuid; v_plan uuid;
  v_first record; v_repeat record;
begin
  select p.proargnames into v_args from pg_catalog.pg_proc p
  where p.oid='public.acquire_billing_checkout_intent_v2(uuid,uuid,uuid,text)'::regprocedure;
  perform pg_temp.assert_true(v_args[1:4]=array['p_salon_id','p_actor_profile_id','p_requested_plan_id','p_provider'],'V2_ARGUMENTS_INVALID');
  perform pg_temp.assert_true(not ('p_environment'=any(v_args)),'CALLER_ENVIRONMENT_ACCEPTED');
  select pg_catalog.pg_get_functiondef('public.acquire_billing_checkout_intent_v2(uuid,uuid,uuid,text)'::regprocedure) into v_definition;
  perform pg_temp.assert_true(v_definition ilike '%security definer%' and v_definition ilike '%SET search_path TO %''''%','V2_SECURITY_CONTRACT_INVALID');
  perform pg_temp.assert_true(v_definition ilike '%pg_advisory_xact_lock%from public.billing_checkout_sessions%for update%select s.*%for update%insert into public.billing_checkout_sessions%','V2_LOCK_ORDER_INVALID');
  perform pg_temp.assert_true(v_definition ilike '%private.billing_runtime_config%' and v_definition not ilike '%p_environment%','DB_ENVIRONMENT_AUTHORITY_INVALID');

  v_owner:=extensions.gen_random_uuid(); v_salon:=extensions.gen_random_uuid();
  select id into strict v_plan from public.plans where slug='starter';
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(v_owner,v_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug) values(v_salon,v_owner,'B10 allowed','b10-'||replace(v_salon::text,'-',''));
  select * into strict v_first from public.acquire_billing_checkout_intent_v2(v_salon,v_owner,v_plan,'lemonsqueezy');
  select * into strict v_repeat from public.acquire_billing_checkout_intent_v2(v_salon,v_owner,v_plan,'lemonsqueezy');
  perform pg_temp.assert_true(v_first.acquisition_outcome='created' and v_first.status='creating','PROVIDER_FREE_TRIAL_NOT_CREATED');
  perform pg_temp.assert_true(v_repeat.acquisition_outcome='existing' and v_repeat.checkout_session_id=v_first.checkout_session_id,'ACTIVE_INTENT_NOT_REUSED');

  update public.billing_checkout_sessions set status='failed',failed_at=now(),error_code='fixture' where id=v_first.checkout_session_id;
  update public.subscriptions set trial_starts_at=now()-interval '15 days',trial_ends_at=now()-interval '1 day' where salon_id=v_salon;
  select * into strict v_first from public.acquire_billing_checkout_intent_v2(v_salon,v_owner,v_plan,'lemonsqueezy');
  perform pg_temp.assert_true(v_first.acquisition_outcome='created','EXPIRED_PROVIDER_FREE_TRIAL_NOT_CREATED');
  update public.billing_checkout_sessions set status='completed',completed_at=now() where id=v_first.checkout_session_id;
  perform pg_temp.assert_blocked(v_salon,v_owner,v_plan,'BILLING_RECONCILIATION_REQUIRED_COMPLETED_CHECKOUT');
end $$;

do $$
declare v_owner uuid; v_salon uuid; v_plan uuid; v_status public.subscription_status;
  v_expected text; v_period timestamptz; v_i integer;
begin
  select id into strict v_plan from public.plans where slug='starter';
  for v_i in 1..6 loop
    v_owner:=extensions.gen_random_uuid(); v_salon:=extensions.gen_random_uuid();
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(v_owner,v_owner||'@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug) values(v_salon,v_owner,'B10 linked','b10-'||replace(v_salon::text,'-',''));
    perform * from public.acquire_billing_checkout_intent_v2(v_salon,v_owner,v_plan,'lemonsqueezy');
    update public.billing_checkout_sessions set status='completed',completed_at=now()
      where salon_id=v_salon and status='creating';
    v_status:=case v_i when 1 then 'active' when 2 then 'cancelled' when 3 then 'past_due' when 4 then 'expired' when 5 then 'cancelled' else 'trialing' end;
    v_expected:=case when v_i in (1,2,6) then 'BILLING_SUBSCRIPTION_ALREADY_ACTIVE'
      when v_i=3 then 'BILLING_SUBSCRIPTION_PAYMENT_REQUIRED'
      else 'BILLING_SUBSCRIPTION_REACTIVATION_REQUIRED' end;
    v_period:=case when v_i in (1,2) then now()+interval '1 day' else now()-interval '1 day' end;
    update public.subscriptions set status=v_status,billing_provider='lemonsqueezy',billing_environment='test',
      provider_customer_id='customer-'||v_i,provider_subscription_id='subscription-'||v_i||'-'||v_salon,
      current_period_starts_at=v_period-interval '30 days',current_period_ends_at=v_period,
      provider_state_updated_at=now() where salon_id=v_salon;
    perform pg_temp.assert_blocked(v_salon,v_owner,v_plan,v_expected);
  end loop;
end $$;

do $$
declare v_owner uuid; v_salon uuid; v_plan uuid;
begin
  select id into strict v_plan from public.plans where slug='starter';
  for v_owner,v_salon in select extensions.gen_random_uuid(),extensions.gen_random_uuid() loop
    insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(v_owner,v_owner||'@example.invalid','{}','{}');
    insert into public.salons(id,owner_id,name,slug) values(v_salon,v_owner,'B10 inconsistent','b10-'||replace(v_salon::text,'-',''));
    perform * from public.acquire_billing_checkout_intent_v2(v_salon,v_owner,v_plan,'lemonsqueezy');
    update public.billing_checkout_sessions set status='completed',completed_at=now()
      where salon_id=v_salon and status='creating';
    update public.subscriptions set status='active',billing_provider='lemonsqueezy',billing_environment='live',
      provider_customer_id='customer',provider_subscription_id='subscription-'||v_salon,
      current_period_starts_at=now()-interval '1 day',current_period_ends_at=now()+interval '29 days',
      provider_state_updated_at=now() where salon_id=v_salon;
    perform pg_temp.assert_blocked(v_salon,v_owner,v_plan,'BILLING_RECONCILIATION_REQUIRED_PROVIDER_METADATA');
  end loop;
  update private.billing_runtime_config set environment='live',updated_at=now() where singleton=true;
  update public.subscriptions set billing_environment='test' where salon_id=v_salon;
  perform pg_temp.assert_blocked(v_salon,v_owner,v_plan,'BILLING_RECONCILIATION_REQUIRED_PROVIDER_METADATA');
  update private.billing_runtime_config set environment='test',updated_at=now() where singleton=true;

  v_owner:=extensions.gen_random_uuid(); v_salon:=extensions.gen_random_uuid();
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(v_owner,v_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug) values(v_salon,v_owner,'B10 partial','b10-'||replace(v_salon::text,'-',''));
  update public.subscriptions set billing_provider='lemonsqueezy',billing_environment='test' where salon_id=v_salon;
  perform pg_temp.assert_blocked(v_salon,v_owner,v_plan,'BILLING_RECONCILIATION_REQUIRED_PROVIDER_METADATA');

  v_owner:=extensions.gen_random_uuid(); v_salon:=extensions.gen_random_uuid();
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(v_owner,v_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug) values(v_salon,v_owner,'B10 missing','b10-'||replace(v_salon::text,'-',''));
  delete from public.subscriptions where salon_id=v_salon;
  perform pg_temp.assert_blocked(v_salon,v_owner,v_plan,'BILLING_RECONCILIATION_REQUIRED_SUBSCRIPTION_CARDINALITY');

  delete from private.billing_runtime_config;
  begin
    perform * from public.acquire_billing_checkout_intent_v2(v_salon,v_owner,v_plan,'lemonsqueezy');
    raise exception 'EXPECTED_RUNTIME_BLOCK';
  exception when others then
    perform pg_temp.assert_true(sqlerrm='BILLING_RECONCILIATION_REQUIRED_RUNTIME_CONFIG','MISSING_RUNTIME_NOT_BLOCKED');
  end;
end $$;

do $$ begin
  perform pg_temp.assert_true(has_function_privilege('service_role','public.acquire_billing_checkout_intent_v2(uuid,uuid,uuid,text)','execute'),'SERVICE_ROLE_EXECUTE_MISSING');
  perform pg_temp.assert_true(not has_function_privilege('anon','public.acquire_billing_checkout_intent_v2(uuid,uuid,uuid,text)','execute'),'ANON_EXECUTE_ALLOWED');
  perform pg_temp.assert_true(not has_function_privilege('authenticated','public.acquire_billing_checkout_intent_v2(uuid,uuid,uuid,text)','execute'),'AUTHENTICATED_EXECUTE_ALLOWED');
  perform pg_temp.assert_true(not has_function_privilege('public','public.acquire_billing_checkout_intent_v2(uuid,uuid,uuid,text)','execute'),'PUBLIC_EXECUTE_ALLOWED');
end $$;

rollback;
