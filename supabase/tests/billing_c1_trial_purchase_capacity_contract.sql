\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------- fixtures
create function pg_temp.trial_salon(p_label text)
returns table(owner_id uuid, salon_id uuid, subscription_id uuid)
language plpgsql as $$
begin
  owner_id := gen_random_uuid();
  salon_id := gen_random_uuid();
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(owner_id,owner_id||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values(salon_id,owner_id,p_label,p_label||'-'||substr(salon_id::text,1,8));
  select s.id into subscription_id from public.subscriptions s where s.salon_id=trial_salon.salon_id;
  return next;
end;
$$;

create function pg_temp.add_employees(p_salon uuid, p_count integer, p_active boolean default true)
returns void language plpgsql as $$
declare v_i integer;
begin
  for v_i in 1..p_count loop
    insert into public.employees(salon_id,full_name,is_active) values(p_salon,'Employee '||v_i,p_active);
  end loop;
end;
$$;

create function pg_temp.try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end;
$$;

create function pg_temp.acquire(p_salon uuid, p_owner uuid, p_plan text) returns text
language plpgsql as $$
declare v_row record;
begin
  select * into v_row from public.acquire_billing_checkout_intent_v2(
    p_salon,p_owner,(select id from public.plans where slug=p_plan),'lemonsqueezy');
  return 'ok:'||v_row.checkout_session_id;
exception when others then
  return sqlerrm;
end;
$$;

create function pg_temp.open_checkout(p_checkout uuid, p_expires timestamptz) returns void
language sql as $$
  update public.billing_checkout_sessions
  set status='open', provider_session_id=gen_random_uuid()::text,
      checkout_url_hash=encode(digest(p_checkout::text,'sha256'),'hex'), expires_at=p_expires
  where id=p_checkout;
$$;

create function pg_temp.created_event(p_salon uuid, p_checkout uuid, p_suffix text, p_plan text default 'starter')
returns uuid language plpgsql as $$
declare v_id uuid; v_key uuid;
begin
  select idempotency_key into v_key from public.billing_checkout_sessions where id=p_checkout;
  select event_id into v_id from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_created','subscriptions','sub-'||p_suffix,
    encode(digest('event-'||p_suffix,'sha256'),'hex'),encode(digest('semantic-'||p_suffix,'sha256'),'hex'),
    'received',null,true,p_checkout,p_salon,p_plan,v_key,
    'sub-'||p_suffix,'order-'||p_suffix,'customer-'||p_suffix,
    'product-test-'||p_plan,'variant-test-'||p_plan,'active',
    now()-interval '1 hour',now()-interval '30 minutes',true,'ready',null,'store-test',
    now()+interval '30 days',null,false,null,null,null);
  return v_id;
end;
$$;

create function pg_temp.process(p_event uuid) returns text language sql as $$
  select outcome||coalesce(':'||error_code,'') from public.process_billing_subscription_created_v2(p_event);
$$;

create function pg_temp.capacity(p_salon uuid) returns jsonb language sql as $$
  select to_jsonb(c) from public.resolve_employee_capacity_v2(p_salon) c;
$$;

create function pg_temp.plan_event(p_event uuid) returns jsonb language sql as $$
  select to_jsonb(r) from public.plan_billing_event_reprocess_v1('test',p_event) r;
$$;

create function pg_temp.apply_event(p_event uuid, p_token text) returns jsonb language sql as $$
  select to_jsonb(r) from public.apply_billing_event_reprocess_v1('test',p_event,p_token,'OPS-C1','c1 contract recovery','tester') r;
$$;

create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims',json_build_object('sub',p_user,'role','authenticated')::text,true);
  select set_config('request.jwt.claim.sub',p_user::text,true);
$$;

-- ---------------------------------------------------------------- catalogue + authority
do $$
begin
  insert into private.billing_runtime_config(singleton,environment) values(true,'test')
  on conflict(singleton) do update set environment='test';
  insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,
    provider_product_id,provider_variant_id,provider_store_id,is_active)
  select p.id,'lemonsqueezy','test','monthly',p.currency,p.monthly_price,'product-test-'||p.slug,'variant-test-'||p.slug,'store-test',true
  from public.plans p where p.slug in ('starter','pro')
  on conflict(provider,environment,plan_id,billing_interval,currency) do update set
    provider_product_id=excluded.provider_product_id,provider_variant_id=excluded.provider_variant_id,
    provider_store_id=excluded.provider_store_id,is_active=true;
  if (select max_employees from public.plans where slug='starter')<>3 or (select max_employees from public.plans where slug='pro')<>10 then
    raise exception 'FIXTURE_PLAN_LIMITS_CHANGED';
  end if;
end;
$$;

-- ---------------------------------------------------------------- shape / ACL
do $$
declare v_fn text;
begin
  foreach v_fn in array array['public.resolve_employee_capacity_v2(uuid,timestamptz)','public.resolve_billing_purchase_activation_v1(uuid)'] loop
    if has_function_privilege('anon',v_fn,'execute') or has_function_privilege('authenticated',v_fn,'execute')
       or not has_function_privilege('service_role',v_fn,'execute')
       or not (select prosecdef from pg_proc where oid=v_fn::regprocedure)
       or (select proconfig from pg_proc where oid=v_fn::regprocedure) is distinct from array['search_path=""'] then
      raise exception 'C1_FUNCTION_ACL_INVALID %',v_fn;
    end if;
  end loop;
  if has_function_privilege('anon','public.set_employee_active_state(uuid,boolean)','execute') then
    raise exception 'ANON_CAN_SET_EMPLOYEE_STATE';
  end if;
end;
$$;

-- ---------------------------------------------------------------- 1, 2, 5, 17: precondition, reservation, expiry, authority
do $$
declare v_s record; v_r text; v_cap jsonb; v_checkout uuid; v_inactive uuid;
begin
  -- 1. four active employees: Starter refused before any provider call, nothing written
  select * into v_s from pg_temp.trial_salon('c1-over');
  perform pg_temp.add_employees(v_s.salon_id,4);
  v_r := pg_temp.acquire(v_s.salon_id,v_s.owner_id,'starter');
  if v_r<>'EMPLOYEE_OVER_TARGET_LIMIT'
     or exists(select 1 from public.billing_checkout_sessions where salon_id=v_s.salon_id) then
    raise exception 'OVER_TARGET_NOT_REFUSED %',v_r; end if;
  -- Pro is not limited by the Starter target
  if pg_temp.acquire(v_s.salon_id,v_s.owner_id,'pro') not like 'ok:%' then raise exception 'PRO_PURCHASE_BLOCKED'; end if;
  if (pg_temp.capacity(v_s.salon_id))->>'capacity_reason'<>'plan' then raise exception 'PRO_CHECKOUT_NARROWED_CAPACITY'; end if;

  -- 2. three active: Starter allowed, the next activation and reactivation are refused
  select * into v_s from pg_temp.trial_salon('c1-reserve');
  perform pg_temp.add_employees(v_s.salon_id,3);
  perform pg_temp.add_employees(v_s.salon_id,1,false);
  select id into v_inactive from public.employees where salon_id=v_s.salon_id and not is_active;
  v_r := pg_temp.acquire(v_s.salon_id,v_s.owner_id,'starter');
  if v_r not like 'ok:%' then raise exception 'ALLOWED_STARTER_REFUSED %',v_r; end if;
  v_checkout := substr(v_r,4)::uuid;
  v_cap := pg_temp.capacity(v_s.salon_id);
  if v_cap->>'capacity_reason'<>'pending_checkout' or (v_cap->>'max_employees')::int<>3
     or (v_cap->>'plan_max_employees')::int<>10 or v_cap->>'pending_plan_slug'<>'starter'
     or (v_cap->>'pending_checkout_id')::uuid<>v_checkout or (v_cap->>'has_full_access')::boolean is not true then
    raise exception 'RESERVATION_SHAPE_WRONG %',v_cap; end if;
  if (select effective_plan_slug from public.resolve_salon_access_v1(v_s.salon_id))<>'pro' then
    raise exception 'TRIAL_CONVERTED_BEFORE_ACTIVATION'; end if;
  v_r := pg_temp.try(format('insert into public.employees(salon_id,full_name) values(%L,%L)',v_s.salon_id,'Fourth'));
  if v_r<>'EMPLOYEE_PURCHASE_LIMIT_PENDING' then raise exception 'FOURTH_EMPLOYEE_ALLOWED %',v_r; end if;
  v_r := pg_temp.try(format('update public.employees set is_active=true where id=%L',v_inactive));
  if v_r<>'EMPLOYEE_PURCHASE_LIMIT_PENDING' then raise exception 'REACTIVATION_ALLOWED %',v_r; end if;
  -- the reserved open checkout is not offered again once over the target either
  -- 5. reservation survives the local/provider URL expiry while the checkout is open
  perform pg_temp.open_checkout(v_checkout,now()-interval '1 day');
  if pg_temp.try(format('insert into public.employees(salon_id,full_name) values(%L,%L)',v_s.salon_id,'Late'))<>'EMPLOYEE_PURCHASE_LIMIT_PENDING' then
    raise exception 'RESERVATION_DROPPED_AT_EXPIRES_AT'; end if;
  -- confirmed provider rejection (failed) releases it
  update public.billing_checkout_sessions set status='failed',failed_at=now(),error_code='fixture' where id=v_checkout;
  if pg_temp.try(format('insert into public.employees(salon_id,full_name) values(%L,%L)',v_s.salon_id,'After failed'))<>'ok' then
    raise exception 'FAILED_CHECKOUT_KEEPS_RESERVATION'; end if;
  -- 17. plan limit of v2 equals v1
  if (pg_temp.capacity(v_s.salon_id))->>'plan_max_employees' is distinct from
     (select max_employees::text from public.resolve_employee_capacity_v1(v_s.salon_id)) then
    raise exception 'V1_V2_PLAN_LIMIT_DIVERGED'; end if;
end;
$$;

-- ---------------------------------------------------------------- 6: override does not bypass the pending target
do $$
declare v_s record; v_cap jsonb; v_access record;
begin
  select * into v_s from pg_temp.trial_salon('c1-override');
  perform pg_temp.add_employees(v_s.salon_id,2);
  if pg_temp.acquire(v_s.salon_id,v_s.owner_id,'starter') not like 'ok:%' then raise exception 'OVERRIDE_SETUP'; end if;
  insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,starts_at)
  select v_s.salon_id,id,'internal','c1 override test',now()-interval '1 hour' from public.plans where slug='premium';
  v_cap := pg_temp.capacity(v_s.salon_id);
  select * into v_access from public.resolve_salon_access_v1(v_s.salon_id);
  if v_cap->>'capacity_reason'<>'pending_checkout' or (v_cap->>'max_employees')::int<>3
     or (v_cap->>'plan_max_employees')::int<>25 or v_access.access_source<>'billing_override'
     or v_access.effective_plan_slug<>'premium' or not v_access.has_full_access then
    raise exception 'OVERRIDE_CAPACITY_WRONG % %',v_cap,to_jsonb(v_access); end if;
  perform pg_temp.add_employees(v_s.salon_id,1);
  if pg_temp.try(format('insert into public.employees(salon_id,full_name) values(%L,%L)',v_s.salon_id,'Fourth'))<>'EMPLOYEE_PURCHASE_LIMIT_PENDING' then
    raise exception 'OVERRIDE_BYPASSED_PENDING_TARGET'; end if;
end;
$$;

-- ---------------------------------------------------------------- 7, 18, 9, 13: legacy over-limit checkout, pending guard, recovery
do $$
declare v_s record; v_r text; v_checkout uuid; v_event uuid; v_plan jsonb; v_res jsonb; v_act record; v_victim uuid; v_token text;
begin
  select * into v_s from pg_temp.trial_salon('c1-legacy');
  perform pg_temp.add_employees(v_s.salon_id,3);
  v_r := pg_temp.acquire(v_s.salon_id,v_s.owner_id,'starter');
  v_checkout := substr(v_r,4)::uuid;
  perform pg_temp.open_checkout(v_checkout,now()+interval '30 minutes');
  -- simulate a checkout opened before C1 existed: a 4th employee was activated meanwhile
  alter table public.employees disable trigger user;
  insert into public.employees(salon_id,full_name) values(v_s.salon_id,'Pre-C1 fourth');
  alter table public.employees enable trigger user;

  v_event := pg_temp.created_event(v_s.salon_id,v_checkout,'legacy');
  v_r := pg_temp.process(v_event);
  if v_r<>'manual_review:processor_checkout_capacity_exceeded' then raise exception 'LEGACY_OVER_LIMIT_ACTIVATED %',v_r; end if;
  if (select plan_id from public.subscriptions where id=v_s.subscription_id)<>(select id from public.plans where slug='pro')
     or exists(select 1 from public.subscriptions where id=v_s.subscription_id and billing_provider is not null)
     or (select status from public.billing_checkout_sessions where id=v_checkout)<>'open'
     or (select salon_id from public.billing_webhook_events where id=v_event) is distinct from v_s.salon_id then
    raise exception 'CAPACITY_PARKING_STATE_WRONG'; end if;
  select * into v_act from public.resolve_billing_purchase_activation_v1(v_s.salon_id);
  if v_act.webhook_event_id is distinct from v_event or v_act.pending_reason<>'capacity'
     or v_act.target_max_employees<>3 or v_act.payment_confirmed then raise exception 'PENDING_ACTIVATION_WRONG %',to_jsonb(v_act); end if;
  -- 18. a new purchase is blocked while it waits (and the open checkout is not replaced)
  if pg_temp.acquire(v_s.salon_id,v_s.owner_id,'pro')<>'BILLING_PURCHASE_ACTIVATION_PENDING' then raise exception 'NEW_PURCHASE_NOT_BLOCKED'; end if;
  -- only a paid initial invoice for the same provider subscription confirms payment
  perform public.ingest_billing_subscription_invoice_evidence_v1('lemonsqueezy','test','subscription_payment_success','subscription-invoices','7001',
    encode(digest('inv-legacy','sha256'),'hex'),encode(digest('inv-legacy-s','sha256'),'hex'),true,'7001','7002','7003','7004','initial','paid',now(),now());
  if (select payment_confirmed from public.resolve_billing_purchase_activation_v1(v_s.salon_id)) then
    raise exception 'UNRELATED_INVOICE_CONFIRMED_PAYMENT'; end if;

  -- 9. recovery refused until the owner reduces active employees, then succeeds
  v_plan := pg_temp.plan_event(v_event);
  if v_plan->>'verdict'<>'precondition_unmet' or v_plan->>'error_code'<>'recovery_target_capacity_exceeded' then
    raise exception 'RECOVERY_IGNORED_CAPACITY %',v_plan; end if;
  select id into v_victim from public.employees where salon_id=v_s.salon_id and full_name='Pre-C1 fourth';
  perform pg_temp.as_user(v_s.owner_id);
  perform public.set_employee_active_state(v_victim,false);
  v_plan := pg_temp.plan_event(v_event);
  if v_plan->>'verdict'<>'eligible' then raise exception 'RECOVERY_NOT_ELIGIBLE %',v_plan; end if;
  -- 13. stale review token after any relevant change
  v_token := v_plan->>'review_token';
  -- a relevant change between dry-run and apply: one more employee deactivated
  perform public.set_employee_active_state((select id from public.employees where salon_id=v_s.salon_id and is_active order by created_at, id limit 1),false);
  v_res := pg_temp.apply_event(v_event,v_token);
  if v_res->>'outcome'<>'stale' then raise exception 'STALE_TOKEN_ACCEPTED %',v_res; end if;
  v_plan := pg_temp.plan_event(v_event);
  v_res := pg_temp.apply_event(v_event,v_plan->>'review_token');
  if v_res->>'outcome'<>'reprocessed' then raise exception 'CAPACITY_RECOVERY_FAILED %',v_res; end if;
  if not exists(select 1 from public.subscriptions where id=v_s.subscription_id and status='active'
        and plan_id=(select id from public.plans where slug='starter') and provider_subscription_id='sub-legacy')
     or (select status from public.billing_checkout_sessions where id=v_checkout)<>'completed'
     or exists(select 1 from public.resolve_billing_purchase_activation_v1(v_s.salon_id)) then
    raise exception 'CAPACITY_RECOVERY_STATE_WRONG'; end if;
  if not exists(select 1 from public.billing_recovery_attempts where webhook_event_id=v_event and outcome='reprocessed'
        and prior_state->>'error_code'='processor_checkout_capacity_exceeded') then raise exception 'CAPACITY_RECOVERY_NOT_AUDITED'; end if;
  -- duplicate apply: no second effect
  v_res := pg_temp.apply_event(v_event,v_plan->>'review_token');
  if v_res->>'outcome'<>'no_change' then raise exception 'DUPLICATE_APPLY %',v_res; end if;
  -- after activation the Starter plan limit applies directly
  if pg_temp.try(format('insert into public.employees(salon_id,full_name) values(%L,%L)',v_s.salon_id,'Third'))<>'ok' then
    raise exception 'STARTER_THIRD_REFUSED'; end if;
  if pg_temp.try(format('insert into public.employees(salon_id,full_name) values(%L,%L)',v_s.salon_id,'After'))<>'EMPLOYEE_LIMIT_REACHED' then
    raise exception 'STARTER_LIMIT_NOT_APPLIED'; end if;
end;
$$;

-- ---------------------------------------------------------------- 8: read-only deactivation only
do $$
declare v_s record; v_other record; v_emp uuid; v_r text;
begin
  select * into v_s from pg_temp.trial_salon('c1-readonly');
  select * into v_other from pg_temp.trial_salon('c1-other-tenant');
  perform pg_temp.add_employees(v_s.salon_id,2);
  select id into v_emp from public.employees where salon_id=v_s.salon_id order by created_at, id limit 1;
  update public.subscriptions set trial_starts_at=now()-interval '20 days',trial_ends_at=now()-interval '1 day' where id=v_s.subscription_id;
  if (select has_full_access from public.resolve_salon_access_v1(v_s.salon_id)) then raise exception 'FIXTURE_NOT_READ_ONLY'; end if;
  perform pg_temp.as_user(v_other.owner_id);
  v_r := pg_temp.try(format('select public.set_employee_active_state(%L,false)',v_emp));
  if v_r<>'FORBIDDEN' then raise exception 'OTHER_TENANT_DEACTIVATED %',v_r; end if;
  perform pg_temp.as_user(v_s.owner_id);
  v_r := pg_temp.try(format('select public.set_employee_active_state(%L,false)',v_emp));
  if v_r<>'ok' or (select is_active or is_bookable or is_public from public.employees where id=v_emp) then
    raise exception 'READ_ONLY_DEACTIVATION_FAILED %',v_r; end if;
  if pg_temp.try(format('select public.set_employee_active_state(%L,true)',v_emp))<>'EMPLOYEE_ACCESS_REQUIRED' then
    raise exception 'READ_ONLY_ACTIVATION_ALLOWED'; end if;
  if pg_temp.try(format('select public.update_employee_details_v1(%L,%L,null,null,null,null,null,null,null)',v_emp,'Renamed'))<>'EMPLOYEE_ACCESS_REQUIRED' then
    raise exception 'READ_ONLY_DETAILS_EDIT_ALLOWED'; end if;
end;
$$;

-- ---------------------------------------------------------------- 10, 12, 16: expired checkout + late created; rollback; trial expiry
do $$
declare v_s record; v_r text; v_checkout uuid; v_event uuid; v_plan jsonb; v_res jsonb; v_before jsonb;
begin
  select * into v_s from pg_temp.trial_salon('c1-late');
  perform pg_temp.add_employees(v_s.salon_id,2);
  v_checkout := substr(pg_temp.acquire(v_s.salon_id,v_s.owner_id,'starter'),4)::uuid;
  perform pg_temp.open_checkout(v_checkout,now()-interval '1 hour');
  update public.billing_checkout_sessions set status='expired' where id=v_checkout;  -- replacement-style local expiry
  -- 16. the trial also ended while the payment was in flight
  update public.subscriptions set trial_starts_at=now()-interval '20 days',trial_ends_at=now()-interval '1 hour' where id=v_s.subscription_id;
  v_event := pg_temp.created_event(v_s.salon_id,v_checkout,'late');
  v_r := pg_temp.process(v_event);
  if v_r<>'manual_review:processor_checkout_state_invalid'
     or (select salon_id from public.billing_webhook_events where id=v_event) is distinct from v_s.salon_id then
    raise exception 'LATE_CREATED_NOT_PARKED % %',v_r,(select salon_id from public.billing_webhook_events where id=v_event); end if;
  if (select pending_reason from public.resolve_billing_purchase_activation_v1(v_s.salon_id))<>'review' then raise exception 'LATE_NOT_PENDING'; end if;

  -- 12. a processor rejection inside recovery rolls everything back
  update public.billing_provider_prices set provider_variant_id='variant-test-starter-moved'
  where environment='test' and plan_id=(select id from public.plans where slug='starter');
  v_before := jsonb_build_object('checkout',(select to_jsonb(c) - 'updated_at' from public.billing_checkout_sessions c where c.id=v_checkout),
    'subscription',(select to_jsonb(s) from public.subscriptions s where s.id=v_s.subscription_id),
    'event',(select jsonb_build_object('status',processing_status,'code',error_code) from public.billing_webhook_events where id=v_event));
  v_plan := pg_temp.plan_event(v_event);
  if v_plan->>'verdict'<>'eligible' then raise exception 'LATE_NOT_ELIGIBLE %',v_plan; end if;
  v_res := pg_temp.apply_event(v_event,v_plan->>'review_token');
  if v_res->>'outcome'<>'activation_rejected' or v_res->>'error_code'<>'processor_provider_mapping_invalid' then
    raise exception 'ROLLBACK_OUTCOME_WRONG %',v_res; end if;
  if jsonb_build_object('checkout',(select to_jsonb(c) - 'updated_at' from public.billing_checkout_sessions c where c.id=v_checkout),
       'subscription',(select to_jsonb(s) from public.subscriptions s where s.id=v_s.subscription_id),
       'event',(select jsonb_build_object('status',processing_status,'code',error_code) from public.billing_webhook_events where id=v_event))
     is distinct from v_before then raise exception 'ROLLBACK_LEFT_CHANGES'; end if;
  if not exists(select 1 from public.billing_recovery_attempts where webhook_event_id=v_event and outcome='activation_rejected'
        and applied_state->>'rolled_back'='true') then raise exception 'ROLLBACK_NOT_AUDITED'; end if;
  update public.billing_provider_prices set provider_variant_id='variant-test-starter'
  where environment='test' and plan_id=(select id from public.plans where slug='starter');

  -- 10. controlled recovery of the expired checkout
  v_plan := pg_temp.plan_event(v_event);
  v_res := pg_temp.apply_event(v_event,v_plan->>'review_token');
  if v_res->>'outcome'<>'reprocessed'
     or (select status from public.billing_checkout_sessions where id=v_checkout)<>'completed'
     or not exists(select 1 from public.subscriptions where id=v_s.subscription_id and status='active'
        and provider_subscription_id='sub-late' and plan_id=(select id from public.plans where slug='starter')) then
    raise exception 'LATE_RECOVERY_FAILED %',v_res; end if;
  if (select processing_status from public.billing_webhook_events where id=v_event)<>'processed' then raise exception 'LATE_EVENT_NOT_PROCESSED'; end if;
end;
$$;

-- ---------------------------------------------------------------- 11, 14: replacement and identity conflicts stay refused
do $$
declare v_s record; v_a uuid; v_event uuid; v_plan jsonb; v_res jsonb; v_code text; v_b record;
begin
  select * into v_s from pg_temp.trial_salon('c1-replacement');
  perform pg_temp.add_employees(v_s.salon_id,1);
  v_a := substr(pg_temp.acquire(v_s.salon_id,v_s.owner_id,'starter'),4)::uuid;
  perform pg_temp.open_checkout(v_a,now()-interval '2 hours');
  -- A was created in an earlier transaction than its replacement
  update public.billing_checkout_sessions set created_at=now()-interval '3 hours' where id=v_a;
  -- the replacement flow expires A and opens B; B's URL also expires with no created event
  if pg_temp.acquire(v_s.salon_id,v_s.owner_id,'starter') not like 'ok:%' then raise exception 'REPLACEMENT_SETUP'; end if;
  if (select status from public.billing_checkout_sessions where id=v_a)<>'expired' then raise exception 'A_NOT_REPLACED'; end if;
  update public.billing_checkout_sessions set status='open',provider_session_id='b-session',
    checkout_url_hash=encode(digest('b','sha256'),'hex'),expires_at=now()-interval '1 hour'
  where salon_id=v_s.salon_id and status='creating';
  update public.billing_checkout_sessions set status='expired' where salon_id=v_s.salon_id and status='open';
  v_event := pg_temp.created_event(v_s.salon_id,v_a,'replaced-a');
  perform pg_temp.process(v_event);
  v_plan := pg_temp.plan_event(v_event);
  v_res := pg_temp.apply_event(v_event,coalesce(v_plan->>'review_token',repeat('0',64)));
  if v_plan->>'verdict'<>'precondition_unmet' or v_plan->>'error_code'<>'recovery_replacement_checkout_unresolved'
     or v_res->>'outcome'<>'precondition_unmet'
     or (select status from public.billing_checkout_sessions where id=v_a)<>'expired'
     or exists(select 1 from public.subscriptions where id=v_s.subscription_id and billing_provider is not null) then
    raise exception 'AMBIGUOUS_REPLACEMENT_RECOVERED % %',v_plan,v_res; end if;
  -- the replacement block also holds for new purchases
  if pg_temp.acquire(v_s.salon_id,v_s.owner_id,'starter')<>'BILLING_PURCHASE_ACTIVATION_PENDING' then raise exception 'REPLACEMENT_PURCHASE_NOT_BLOCKED'; end if;

  -- 14. already linked subscription is never overwritten
  select * into v_b from pg_temp.trial_salon('c1-linked');
  v_a := substr(pg_temp.acquire(v_b.salon_id,v_b.owner_id,'starter'),4)::uuid;
  perform pg_temp.open_checkout(v_a,now()-interval '1 hour');
  update public.billing_checkout_sessions set status='expired' where id=v_a;
  v_event := pg_temp.created_event(v_b.salon_id,v_a,'linked-late');
  perform pg_temp.process(v_event);
  update public.subscriptions set status='active',billing_provider='lemonsqueezy',billing_environment='test',
    provider_customer_id='other-customer',provider_subscription_id='other-sub',
    current_period_starts_at=now()-interval '1 day',current_period_ends_at=now()+interval '29 days',
    trial_starts_at=null,trial_ends_at=null,provider_state_updated_at=now()-interval '1 day'
  where id=v_b.subscription_id;
  v_plan := pg_temp.plan_event(v_event);
  if v_plan->>'verdict'<>'conflict' or v_plan->>'error_code'<>'recovery_subscription_already_linked' then
    raise exception 'LINKED_SUBSCRIPTION_NOT_PROTECTED %',v_plan; end if;
  -- failed checkout with a created event: checkout state unsupported
  select * into v_b from pg_temp.trial_salon('c1-failed');
  v_a := substr(pg_temp.acquire(v_b.salon_id,v_b.owner_id,'starter'),4)::uuid;
  update public.billing_checkout_sessions set status='failed',failed_at=now(),error_code='fixture' where id=v_a;
  v_event := pg_temp.created_event(v_b.salon_id,v_a,'failed-checkout');
  perform pg_temp.process(v_event);
  if (pg_temp.plan_event(v_event))->>'error_code'<>'recovery_checkout_state_unsupported' then raise exception 'FAILED_CHECKOUT_RECOVERABLE'; end if;
  -- other manual_review reasons stay out of reach
  foreach v_code in array array['processor_checkout_correlation_invalid','processor_plan_correlation_invalid',
      'processor_provider_mapping_invalid','processor_provider_ownership_conflict','processor_completed_checkout_conflict',
      'processor_same_timestamp_conflict','processor_provider_state_unsupported'] loop
    update public.billing_webhook_events set error_code=v_code where id=v_event;
    if (pg_temp.plan_event(v_event))->>'verdict'<>'reason_not_allowed' then raise exception 'REASON_ALLOWED %',v_code; end if;
  end loop;
  -- active worker lease is not taken
  update public.billing_webhook_events set error_code='processor_checkout_state_invalid',
    processing_claim_token=gen_random_uuid(),processing_lease_until=now()+interval '5 minutes' where id=v_event;
  if (pg_temp.plan_event(v_event))->>'verdict'<>'event_busy' then raise exception 'LEASE_IGNORED'; end if;
end;
$$;

-- ---------------------------------------------------------------- 15, 16: idempotent completed event and Pro purchase
do $$
declare v_s record; v_checkout uuid; v_event uuid; v_dup uuid; v_r text; v_key uuid;
begin
  select * into v_s from pg_temp.trial_salon('c1-idempotent');
  perform pg_temp.add_employees(v_s.salon_id,3);
  v_checkout := substr(pg_temp.acquire(v_s.salon_id,v_s.owner_id,'starter'),4)::uuid;
  perform pg_temp.open_checkout(v_checkout,now()+interval '30 minutes');
  v_event := pg_temp.created_event(v_s.salon_id,v_checkout,'idem');
  if pg_temp.process(v_event)<>'processed' then raise exception 'NORMAL_ACTIVATION_FAILED'; end if;
  -- later employee changes do not make the completed event fail on redelivery
  alter table public.employees disable trigger user;
  insert into public.employees(salon_id,full_name) values(v_s.salon_id,'later');
  alter table public.employees enable trigger user;
  if pg_temp.process(v_event)<>'already_processed' then raise exception 'COMPLETED_EVENT_REGRESSED'; end if;
  select idempotency_key into v_key from public.billing_checkout_sessions where id=v_checkout;
  select event_id into v_dup from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_created','subscriptions','sub-idem',
    encode(digest('event-idem-redelivery','sha256'),'hex'),encode(digest('semantic-idem-redelivery','sha256'),'hex'),
    'received',null,true,v_checkout,v_s.salon_id,'starter',v_key,'sub-idem','order-idem','customer-idem',
    'product-test-starter','variant-test-starter','active',
    (select current_period_starts_at from public.subscriptions where id=v_s.subscription_id),
    (select provider_state_updated_at from public.subscriptions where id=v_s.subscription_id),
    true,'ready',null,'store-test',(select current_period_ends_at from public.subscriptions where id=v_s.subscription_id),
    null,false,null,null,null);
  if v_dup is not null then
    v_r := pg_temp.process(v_dup);
    if v_r<>'processed' then raise exception 'SAME_STATE_REDELIVERY_REGRESSED %',v_r; end if;
  end if;

  -- Pro purchase with seven employees is unaffected
  select * into v_s from pg_temp.trial_salon('c1-pro');
  perform pg_temp.add_employees(v_s.salon_id,7);
  v_checkout := substr(pg_temp.acquire(v_s.salon_id,v_s.owner_id,'pro'),4)::uuid;
  perform pg_temp.open_checkout(v_checkout,now()+interval '30 minutes');
  v_event := pg_temp.created_event(v_s.salon_id,v_checkout,'pro-buy','pro');
  if pg_temp.process(v_event)<>'processed' then raise exception 'PRO_ACTIVATION_FAILED'; end if;
end;
$$;

rollback;
select 'billing C1 trial purchase capacity contract passed' as result;
