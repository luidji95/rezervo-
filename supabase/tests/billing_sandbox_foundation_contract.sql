begin;

-- Isolate fixture mappings from operator-created sandbox mappings. The outer
-- rollback restores every pre-existing row after the contract test.
delete from public.billing_provider_prices
where provider = 'lemonsqueezy' and environment = 'test';

do $$
declare
  v_starter uuid;
  v_pro uuid;
  v_premium uuid;
  v_mapping uuid;
  v_rejected boolean;
  v_salon uuid := gen_random_uuid();
  v_owner uuid := gen_random_uuid();
  v_session uuid;
  v_key uuid := gen_random_uuid();
begin
  select id into v_starter from public.plans where slug = 'starter';
  select id into v_pro from public.plans where slug = 'pro';
  select id into v_premium from public.plans where slug = 'premium';

  insert into public.billing_provider_prices(plan_id, provider, environment, billing_interval, currency, amount, provider_variant_id)
  values(v_starter, 'lemonsqueezy', 'test', 'monthly', 'RSD', 2990, 'fixture-starter') returning id into v_mapping;
  insert into public.billing_provider_prices(plan_id, provider, environment, billing_interval, currency, amount, provider_variant_id)
  values(v_pro, 'lemonsqueezy', 'test', 'monthly', 'RSD', 5990, 'fixture-pro');

  v_rejected := false;
  begin insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,provider_variant_id)
    values(v_premium,'lemonsqueezy','test','monthly','RSD',17990,'fixture-premium');
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'PREMIUM_MAPPING_ALLOWED'; end if;

  v_rejected := false;
  begin insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,provider_variant_id)
    values(v_starter,'lemonsqueezy','live','yearly','RSD',2990,'fixture-yearly');
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'YEARLY_MAPPING_ALLOWED'; end if;

  v_rejected := false;
  begin insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,provider_variant_id)
    values(v_starter,'lemonsqueezy','live','monthly','RSD',3000,'fixture-wrong-amount');
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'AMOUNT_MISMATCH_ALLOWED'; end if;

  v_rejected := false;
  begin insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,provider_variant_id)
    values(v_starter,'lemonsqueezy','live','monthly','EUR',2990,'fixture-wrong-currency');
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'CURRENCY_MISMATCH_ALLOWED'; end if;

  v_rejected := false;
  begin insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,provider_variant_id)
    values(v_starter,'lemonsqueezy','test','monthly','RSD',2990,'fixture-duplicate');
  exception when unique_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'DUPLICATE_MAPPING_ALLOWED'; end if;

  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(v_owner, concat(v_owner,'@example.invalid'),'{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values(v_salon,v_owner,'Billing fixture',concat('billing-',replace(v_salon::text,'-','')));

  insert into public.billing_checkout_sessions(salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,status,provider_session_id)
  values(v_salon,v_owner,v_starter,'lemonsqueezy','test',v_key,'open','fixture-session') returning id into v_session;

  v_rejected := false;
  begin insert into public.billing_checkout_sessions(salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key)
    values(v_salon,v_owner,v_starter,'lemonsqueezy','test',v_key);
  exception when unique_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'DUPLICATE_IDEMPOTENCY_ALLOWED'; end if;

  v_rejected := false;
  begin insert into public.billing_checkout_sessions(salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,provider_session_id)
    values(v_salon,v_owner,v_starter,'lemonsqueezy','test',gen_random_uuid(),'fixture-session');
  exception when unique_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'DUPLICATE_PROVIDER_SESSION_ALLOWED'; end if;
end;
$$;

set local role anon;
do $$ declare v_denied boolean; begin
  if has_table_privilege('anon','public.billing_provider_prices','select,insert,update,delete') then raise exception 'ANON_MAPPING_PRIVILEGE_ALLOWED'; end if;
  if has_table_privilege('anon','public.billing_checkout_sessions','select,insert,update,delete') then raise exception 'ANON_SESSION_PRIVILEGE_ALLOWED'; end if;
  v_denied := false;
  begin perform 1 from public.billing_provider_prices; exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'ANON_MAPPING_READ_ALLOWED'; end if;
end $$;
reset role;

set local role authenticated;
do $$ declare v_denied boolean; begin
  if has_table_privilege('authenticated','public.billing_provider_prices','select,insert,update,delete') then raise exception 'AUTH_MAPPING_PRIVILEGE_ALLOWED'; end if;
  if has_table_privilege('authenticated','public.billing_checkout_sessions','select,insert,update,delete') then raise exception 'AUTH_SESSION_PRIVILEGE_ALLOWED'; end if;
  v_denied := false;
  begin perform 1 from public.billing_checkout_sessions; exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'AUTH_SESSION_READ_ALLOWED'; end if;
end $$;
reset role;

set local role service_role;
do $$ begin
  if (select count(*) from public.billing_provider_prices) <> 2 then raise exception 'SERVICE_MAPPING_READ_FAILED'; end if;
  if (select count(*) from public.billing_checkout_sessions) <> 1 then raise exception 'SERVICE_SESSION_READ_FAILED'; end if;
end $$;
reset role;

rollback;
