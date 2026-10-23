\set ON_ERROR_STOP on
begin;

-- E1 resubscribe-after-expiry contract. Disposable database only (see
-- scripts/test-billing-e1-resubscribe.mjs). Provider evidence is simulated through the real
-- ingest/processor/recovery RPCs; no provider is called.

create temp sequence e1_ids start 900001;

create function pg_temp.eq(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'E1_ASSERT % expected=% actual=%', p_label, p_expected, p_actual;
  end if;
end $$;
create function pg_temp.nid() returns text language sql as $$ select nextval('e1_ids')::text $$;
create function pg_temp.variant(p_slug text) returns text language sql as $$
  select case p_slug when 'starter' then '2264918' when 'pro' then '2264940' else '2264999' end $$;

do $$
begin
  insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,
    provider_product_id,provider_variant_id,provider_store_id,is_active)
  select p.id,'lemonsqueezy','test','monthly',p.currency,p.monthly_price,'1451030',
    case p.slug when 'starter' then '2264918' else '2264940' end,'501229',true
  from public.plans p where p.slug in ('starter','pro')
  on conflict(provider,environment,plan_id,billing_interval,currency) do update set
    provider_product_id=excluded.provider_product_id,provider_variant_id=excluded.provider_variant_id,
    provider_store_id=excluded.provider_store_id,is_active=true;
  insert into private.billing_runtime_config(singleton,environment) values(true,'test')
  on conflict(singleton) do update set environment='test';
end $$;

-- A provider-linked salon whose paid period already ended (historic internal trial kept).
create function pg_temp.mk(p_label text, p_slug text default 'starter', p_employees int default 0)
returns table(owner_id uuid, salon_id uuid, sub_id uuid, pid text, customer text)
language plpgsql as $$
begin
  owner_id := gen_random_uuid();
  salon_id := gen_random_uuid();
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(owner_id,owner_id||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug) values(salon_id,owner_id,p_label,p_label||'-'||substr(salon_id::text,1,8));
  select s.id into sub_id from public.subscriptions s where s.salon_id=mk.salon_id;
  pid := pg_temp.nid();
  customer := pg_temp.nid();
  update public.subscriptions set
    plan_id=(select id from public.plans where slug=p_slug),status='active',
    billing_provider='lemonsqueezy',billing_environment='test',
    provider_customer_id=customer,provider_subscription_id=pid,
    trial_starts_at=now()-interval '80 days',trial_ends_at=now()-interval '66 days',
    current_period_starts_at=now()-interval '35 days',
    current_period_ends_at=now()-interval '5 days',
    provider_state_updated_at=now()-interval '35 days',
    cancel_at_period_end=false,cancelled_at=null
  where id=sub_id;
  if p_employees > 0 then
    alter table public.employees disable trigger user;
    insert into public.employees(salon_id,full_name) select mk.salon_id,'E'||g from generate_series(1,p_employees) g;
    alter table public.employees enable trigger user;
  end if;
  return next;
end $$;

-- signed subscription_updated through the real ingest + processor
create function pg_temp.upd(p_pid text, p_customer text, p_salon uuid, p_slug text, p_status text,
  p_updated timestamptz, p_renews timestamptz, p_ends timestamptz) returns text
language plpgsql as $$
declare v_id uuid; v_suffix text := pg_temp.nid(); r record;
begin
  select event_id into v_id from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_updated','subscriptions',p_pid,
    encode(digest('e1-event-'||v_suffix,'sha256'),'hex'),encode(digest('e1-semantic-'||v_suffix,'sha256'),'hex'),
    'received',null,true,gen_random_uuid(),p_salon,p_slug,gen_random_uuid(),
    p_pid,'order-'||p_pid,p_customer,'1451030',pg_temp.variant(p_slug),p_status,
    now()-interval '35 days',p_updated,true,'ready',null,'501229',p_renews,p_ends,
    p_status in ('cancelled','expired'),null,null,null);
  select * into r from public.process_billing_subscription_updated_v2(v_id,now());
  return r.outcome||coalesce(':'||r.error_code,'');
end $$;

create function pg_temp.expire(p_pid text, p_customer text, p_salon uuid, p_slug text default 'starter') returns text
language sql as $$
  select pg_temp.upd(p_pid,p_customer,p_salon,p_slug,'expired',now()-interval '1 hour',null,now()-interval '2 hours') $$;

create function pg_temp.acq(p_salon uuid, p_owner uuid, p_plan text, p_allow boolean default true) returns text
language plpgsql as $$
declare v_row record;
begin
  select * into v_row from public.acquire_billing_checkout_intent_v3(
    p_salon,p_owner,(select id from public.plans where slug=p_plan),'lemonsqueezy',p_allow);
  return v_row.acquisition_outcome||':'||v_row.checkout_session_id;
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.acq_id(p_result text) returns uuid language sql as $$
  select case when p_result ~ '^(created|existing):' then split_part(p_result,':',2)::uuid end $$;

create function pg_temp.elig(p_salon uuid, p_owner uuid) returns text language sql as $$
  select case when e.eligible then 'eligible' else e.reason end
  from public.resolve_billing_resubscribe_eligibility_v1(p_salon,p_owner,now()) e $$;

create function pg_temp.open_checkout(p_checkout uuid, p_expires timestamptz default null) returns void
language sql as $$
  update public.billing_checkout_sessions
  set status='open', provider_session_id=gen_random_uuid()::text,
      checkout_url_hash=encode(digest(p_checkout::text,'sha256'),'hex'),
      expires_at=coalesce(p_expires, clock_timestamp()+interval '30 minutes')
  where id=p_checkout;
$$;

-- signed subscription_created for a checkout (custom data from the checkout ledger)
create function pg_temp.created(p_checkout uuid, p_pid text, p_customer text, p_store text default '501229',
  p_trial_ends timestamptz default null, p_salon_override uuid default null) returns uuid
language plpgsql as $$
declare v_id uuid; v_c public.billing_checkout_sessions; v_slug text; v_suffix text := pg_temp.nid();
begin
  select * into v_c from public.billing_checkout_sessions where id=p_checkout;
  select slug into v_slug from public.plans where id=v_c.requested_plan_id;
  select event_id into v_id from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_created','subscriptions',p_pid,
    encode(digest('e1-created-'||v_suffix,'sha256'),'hex'),encode(digest('e1-created-sem-'||v_suffix,'sha256'),'hex'),
    'received',null,true,p_checkout,coalesce(p_salon_override,v_c.salon_id),v_slug,v_c.idempotency_key,
    p_pid,'order-'||p_pid,p_customer,'1451030',pg_temp.variant(v_slug),
    case when p_trial_ends is null then 'active' else 'on_trial' end,
    now()-interval '5 minutes',now()-interval '4 minutes',true,'ready',null,p_store,
    now()+interval '30 days',null,false,p_trial_ends,null,null);
  return v_id;
end $$;
create function pg_temp.proc(p_event uuid) returns text language sql as $$
  select outcome||coalesce(':'||error_code,'') from public.process_billing_subscription_created_v2(p_event,now()) $$;

create function pg_temp.inv(p_invoice text, p_pid text, p_customer text, p_reason text, p_created timestamptz) returns text
language sql as $$
  select outcome from public.ingest_billing_subscription_invoice_evidence_v1(
    'lemonsqueezy','test','subscription_payment_success','subscription-invoices',p_invoice,
    encode(digest('e1-invoice-'||p_invoice,'sha256'),'hex'),encode(digest('e1-invoice-sem-'||p_invoice,'sha256'),'hex'),
    true,p_invoice,p_pid,p_customer,'501229',p_reason,'paid',p_created,p_created + interval '20 seconds',now());
$$;

create function pg_temp.acc(p_salon uuid) returns text language sql as $$
  select a.has_full_access||':'||coalesce(a.effective_plan_slug,'-')||':'||a.access_reason
  from public.resolve_salon_access_v1(p_salon,now()) a $$;
create function pg_temp.sub(p_salon uuid) returns text language sql as $$
  select s.status||':'||(select slug from public.plans where id=s.plan_id)||':'||s.provider_subscription_id||':'||s.provider_customer_id
  from public.subscriptions s where s.salon_id=p_salon $$;

-- ---------------------------------------------------------------- shape / ACL
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.acquire_billing_checkout_intent_v3(uuid,uuid,uuid,text,boolean)',
    'public.acquire_billing_checkout_intent_v2(uuid,uuid,uuid,text)',
    'public.resolve_billing_resubscribe_eligibility_v1(uuid,uuid,timestamptz)'] loop
    if has_function_privilege('anon',v_fn,'execute') or has_function_privilege('authenticated',v_fn,'execute')
       or not has_function_privilege('service_role',v_fn,'execute')
       or not (select prosecdef from pg_proc where oid=v_fn::regprocedure)
       or (select proconfig from pg_proc where oid=v_fn::regprocedure) is distinct from array['search_path=""'] then
      raise exception 'E1_FUNCTION_ACL_INVALID %',v_fn;
    end if;
  end loop;
  foreach v_fn in array array[
    'private.billing_subscription_generation_v1(uuid)',
    'private.billing_resubscribe_terminal_reason_v1(public.subscriptions,text,timestamptz)',
    'private.billing_resubscribe_acquisition_reason_v1(public.subscriptions,text,timestamptz)'] loop
    if has_function_privilege('service_role',v_fn,'execute') or has_function_privilege('authenticated',v_fn,'execute') then
      raise exception 'E1_PRIVATE_FUNCTION_EXPOSED %',v_fn;
    end if;
  end loop;
  if has_table_privilege('authenticated','public.billing_subscription_provider_generations','select')
     or has_table_privilege('anon','public.billing_subscription_provider_generations','select')
     or has_table_privilege('service_role','public.billing_subscription_provider_generations','insert')
     or has_table_privilege('service_role','public.billing_subscription_provider_generations','update')
     or not (select relrowsecurity from pg_class where oid='public.billing_subscription_provider_generations'::regclass) then
    raise exception 'E1_GENERATION_TABLE_ACL_INVALID';
  end if;
end $$;

-- ---------------------------------------------------------------- 1: verified expiry -> new checkout -> new activation
do $$
declare s record; v_r text; v_checkout uuid; v_event uuid; v_new_pid text := pg_temp.nid();
  v_new_customer text := pg_temp.nid(); v_g record; v_before record; v_fp_before text; v_fp_after text;
  v_other uuid;
begin
  select * into s from pg_temp.mk('e1-happy','starter',2);
  -- active subscription: not a resubscribe
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'subscription_active','active not eligible');
  perform pg_temp.eq(pg_temp.expire(s.pid,s.customer,s.salon_id),'processed','expired webhook');
  perform pg_temp.eq(pg_temp.acc(s.salon_id),'false:starter:expired','expired read-only');
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'eligible','verified expiry eligible');
  -- someone else than the owner
  perform pg_temp.eq(
    (select reason from public.resolve_billing_resubscribe_eligibility_v1(s.salon_id,gen_random_uuid(),now())),
    'not_owner','non-owner');
  -- default-off: without the resubscribe flag the old refusal stays (also through v2)
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'pro',false),'BILLING_SUBSCRIPTION_REACTIVATION_REQUIRED','flag off v3');
  begin
    perform 1 from public.acquire_billing_checkout_intent_v2(s.salon_id,s.owner_id,(select id from public.plans where slug='pro'),'lemonsqueezy');
    raise exception 'V2_ALLOWED_RESUBSCRIBE';
  exception when others then
    perform pg_temp.eq(sqlerrm,'BILLING_SUBSCRIPTION_REACTIVATION_REQUIRED','flag off v2');
  end;
  if exists(select 1 from public.billing_checkout_sessions where salon_id=s.salon_id) then
    raise exception 'FLAG_OFF_CREATED_INTENT'; end if;

  v_r := pg_temp.acq(s.salon_id,s.owner_id,'pro');
  if v_r not like 'created:%' then raise exception 'RESUBSCRIBE_ACQUIRE %',v_r; end if;
  v_checkout := pg_temp.acq_id(v_r);
  perform pg_temp.eq((select resubscribe_from_provider_subscription_id||':'||resubscribe_from_generation
    from public.billing_checkout_sessions where id=v_checkout), s.pid||':1','binding');
  -- no subscription is created or touched by opening a checkout
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'expired:starter:'||s.pid||':'||s.customer,'untouched at acquisition');
  -- same request again resumes the same intent; a different plan is refused by the server (same id here)
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'pro'),'existing:'||v_checkout,'resume creating');
  -- the binding is immutable
  begin
    update public.billing_checkout_sessions set resubscribe_from_generation=2 where id=v_checkout;
    raise exception 'BINDING_MUTABLE';
  exception when others then
    perform pg_temp.eq(sqlerrm,'BILLING_CHECKOUT_RESUBSCRIBE_BINDING_IMMUTABLE','binding immutable');
  end;
  perform pg_temp.open_checkout(v_checkout);
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'pro'),'existing:'||v_checkout,'resume open');

  select * into v_before from public.subscriptions where id=s.sub_id;
  select private.billing_subscription_state_fingerprint_v1(x) into v_fp_before from public.subscriptions x where x.id=s.sub_id;
  -- new customer id is accepted: it is bound by the verified checkout correlation, not by the old row
  v_event := pg_temp.created(v_checkout,v_new_pid,v_new_customer);
  perform pg_temp.eq(pg_temp.proc(v_event),'processed','resubscribe activation');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'active:pro:'||v_new_pid||':'||v_new_customer,'new identity current');
  perform pg_temp.eq(pg_temp.acc(s.salon_id),'true:pro:active_period','canonical full access');
  -- no new trial: historic trial fields are unchanged and not used
  if (select trial_ends_at from public.subscriptions where id=s.sub_id) is distinct from v_before.trial_ends_at
     or (select trial_starts_at from public.subscriptions where id=s.sub_id) is distinct from v_before.trial_starts_at then
    raise exception 'TRIAL_FIELDS_CHANGED'; end if;
  perform pg_temp.eq((select status||':'||coalesce(resulting_subscription_id::text,'-')
    from public.billing_checkout_sessions where id=v_checkout),'completed:'||s.sub_id,'checkout completed');
  select * into v_g from public.billing_subscription_provider_generations where subscription_id=s.sub_id;
  perform pg_temp.eq(v_g.generation||':'||v_g.provider_subscription_id||':'||v_g.provider_customer_id||':'||v_g.final_status
    ||':'||v_g.superseded_by_provider_subscription_id||':'||v_g.superseded_by_checkout_session_id,
    '1:'||s.pid||':'||s.customer||':expired:'||v_new_pid||':'||v_checkout,'history row');
  if v_g.provider_state_updated_at is distinct from v_before.provider_state_updated_at
     or v_g.current_period_ends_at is distinct from v_before.current_period_ends_at
     or v_g.plan_id is distinct from v_before.plan_id then
    raise exception 'HISTORY_SNAPSHOT_WRONG'; end if;
  perform pg_temp.eq(private.billing_subscription_generation_v1(s.sub_id)::text,'2','generation 2');
  select private.billing_subscription_state_fingerprint_v1(x) into v_fp_after from public.subscriptions x where x.id=s.sub_id;
  if v_fp_after = v_fp_before then raise exception 'FINGERPRINT_UNCHANGED'; end if;
  -- capacity follows the new plan; the reservation ended with the checkout
  perform pg_temp.eq((select max_employees||':'||capacity_reason from public.resolve_employee_capacity_v2(s.salon_id)),'10:plan','capacity new plan');
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'subscription_active','after activation');
  -- history is immutable
  begin
    update public.billing_subscription_provider_generations set provider_customer_id='x' where id=v_g.id;
    raise exception 'HISTORY_MUTABLE';
  exception when others then
    perform pg_temp.eq(sqlerrm,'BILLING_PROVIDER_GENERATION_IMMUTABLE','history immutable');
  end;

  -- idempotency: same event again, and a second delivery of the same facts
  perform pg_temp.eq(pg_temp.proc(v_event),'already_processed','replay');
  v_other := pg_temp.created(v_checkout,v_new_pid,v_new_customer);
  perform pg_temp.eq(pg_temp.proc(v_other),'processed','second delivery no change');
  perform pg_temp.eq((select count(*)::text from public.billing_subscription_provider_generations where subscription_id=s.sub_id),'1','one history row');
  -- a different provider subscription for the completed checkout never replaces the new one
  v_other := pg_temp.created(v_checkout,pg_temp.nid(),v_new_customer);
  perform pg_temp.eq(pg_temp.proc(v_other),'manual_review:processor_provider_ownership_conflict','other id for completed');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'active:pro:'||v_new_pid||':'||v_new_customer,'still new identity');

  -- late events of the superseded identity: history only, even with a newer updated_at
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,s.salon_id,'starter','active',now()+interval '1 hour',now()+interval '40 days',null),
    'stale_ignored','late old updated newer timestamp');
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,s.salon_id,'starter','cancelled',now()+interval '2 hours',null,now()+interval '9 days'),
    'stale_ignored','late old cancel');
  perform pg_temp.eq((select count(*)::text from public.billing_webhook_events
    where provider_object_id=s.pid and event_name='subscription_updated' and processing_status='processed'
      and last_processing_outcome='superseded_identity_ignored' and salon_id=s.salon_id),
    '2','history marker');
  -- a late created delivery of the old identity, an old renewal invoice
  perform pg_temp.eq(pg_temp.proc(pg_temp.created(v_checkout,s.pid,s.customer)),'stale_ignored','late old created');
  perform pg_temp.eq(pg_temp.inv(pg_temp.nid(),s.pid,s.customer,'renewal',now()),'invoice_evidence_recorded','old renewal invoice recorded');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'active:pro:'||v_new_pid||':'||v_new_customer,'old events changed nothing');
  if exists(select 1 from public.resolve_billing_purchase_activation_v1(s.salon_id)) then
    raise exception 'OLD_EVENTS_LOOK_PENDING'; end if;
  -- the new identity is processed normally
  perform pg_temp.eq(pg_temp.upd(v_new_pid,v_new_customer,s.salon_id,'pro','cancelled',now()-interval '1 minute',null,now()+interval '30 days'),
    'processed','new identity lifecycle');
  perform pg_temp.eq(pg_temp.acc(s.salon_id),'true:pro:cancelled_until_period_end','new cancel keeps paid period');
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'cancelled_until_period_end','cancelled is resume, not resubscribe');
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'starter'),'BILLING_SUBSCRIPTION_ALREADY_ACTIVE','cancelled acquire refused');
end $$;

-- ---------------------------------------------------------------- 2: states that are not a resubscribe
do $$
declare s record;
begin
  -- cancelled, paid period still running
  select * into s from pg_temp.mk('e1-cancelled');
  update public.subscriptions set status='cancelled',cancel_at_period_end=true,cancelled_at=now()-interval '1 day',
    current_period_ends_at=now()+interval '3 days' where id=s.sub_id;
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'cancelled_until_period_end','cancelled before end');
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'starter'),'BILLING_SUBSCRIPTION_ALREADY_ACTIVE','cancelled before end acquire');
  -- cancelled, period end in the past, no expired event yet: local time is not terminal evidence
  update public.subscriptions set current_period_ends_at=now()-interval '1 hour' where id=s.sub_id;
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'terminal_state_unconfirmed','cancelled past end');
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'starter'),'BILLING_SUBSCRIPTION_REACTIVATION_REQUIRED','cancelled past end acquire');
  -- expired written without verified lifecycle evidence
  update public.subscriptions set status='expired' where id=s.sub_id;
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'terminal_state_unconfirmed','expired without evidence');
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'starter'),'BILLING_SUBSCRIPTION_REACTIVATION_REQUIRED','expired without evidence acquire');
  if exists(select 1 from public.billing_checkout_sessions where salon_id=s.salon_id) then raise exception 'REFUSED_STATE_WROTE_INTENT'; end if;

  -- past_due / unpaid: payment recovery, never a new checkout
  select * into s from pg_temp.mk('e1-pastdue');
  update public.subscriptions set current_period_ends_at=now()+interval '1 day' where id=s.sub_id;
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,s.salon_id,'starter','unpaid',now()-interval '1 hour',now()+interval '1 day',null),'processed','unpaid webhook');
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'payment_recovery','unpaid');
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'starter'),'BILLING_SUBSCRIPTION_PAYMENT_REQUIRED','unpaid acquire');

  -- active pilot override on an expired subscription (E2 handover, not E1)
  select * into s from pg_temp.mk('e1-override');
  perform pg_temp.eq(pg_temp.expire(s.pid,s.customer,s.salon_id),'processed','override expire');
  insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,starts_at,ends_at)
  select s.salon_id,id,'internal','e1 pilot override',now()-interval '1 day',now()+interval '10 days' from public.plans where slug='pro';
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'override_active','override');
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'starter'),'BILLING_OVERRIDE_ACTIVE','override acquire');

  -- provider-free internal trial / legacy / pilot: not a resubscribe; the initial purchase is unchanged
  select * into s from (select owner_id, salon_id from (select gen_random_uuid() owner_id, gen_random_uuid() salon_id) x) y;
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(s.owner_id,s.owner_id||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug) values(s.salon_id,s.owner_id,'e1-trial','e1-trial-'||substr(s.salon_id::text,1,8));
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'not_applicable','trial');
  if pg_temp.acq(s.salon_id,s.owner_id,'starter') not like 'created:%' then raise exception 'TRIAL_PURCHASE_BROKEN'; end if;
  if (select resubscribe_from_provider_subscription_id from public.billing_checkout_sessions where salon_id=s.salon_id) is not null then
    raise exception 'TRIAL_PURCHASE_BOUND'; end if;
  update public.subscriptions set status='active',trial_starts_at=null,trial_ends_at=null,current_period_ends_at=null
  where salon_id=s.salon_id;
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'not_applicable','legacy provider-free active');
end $$;

-- ---------------------------------------------------------------- 3: C2 changes and terminal evidence through D snapshot
do $$
declare s record; v_change uuid; r record; v_token text;
begin
  -- requested (never confirmed) change: abandoned by the existing evaluator when the expiry applies
  select * into s from pg_temp.mk('e1-c2-requested');
  insert into public.billing_subscription_plan_changes(subscription_id,salon_id,environment,provider_subscription_id,
    provider_customer_id,provider_store_id,direction,from_plan_id,target_plan_id,from_provider_product_id,
    from_provider_variant_id,target_provider_product_id,target_provider_variant_id,baseline_period_end,
    baseline_provider_updated_at,requested_by_profile_id,requested_at,status)
  values(s.sub_id,s.salon_id,'test',s.pid,s.customer,'501229','upgrade',
    (select id from public.plans where slug='starter'),(select id from public.plans where slug='pro'),
    '1451030',pg_temp.variant('starter'),'1451030',pg_temp.variant('pro'),now()+interval '10 days',
    now()-interval '35 days',s.owner_id,now()-interval '6 days','requested') returning id into v_change;
  perform pg_temp.eq(pg_temp.expire(s.pid,s.customer,s.salon_id),'processed','expire with requested change');
  perform pg_temp.eq((select status from public.billing_subscription_plan_changes where id=v_change),'abandoned','requested abandoned');
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'eligible','abandoned change does not block');

  -- manual_review change stays blocking after expiry
  select * into s from pg_temp.mk('e1-c2-review');
  insert into public.billing_subscription_plan_changes(subscription_id,salon_id,environment,provider_subscription_id,
    provider_customer_id,provider_store_id,direction,from_plan_id,target_plan_id,from_provider_product_id,
    from_provider_variant_id,target_provider_product_id,target_provider_variant_id,baseline_period_end,
    baseline_provider_updated_at,requested_by_profile_id,requested_at,status,conflict_code)
  values(s.sub_id,s.salon_id,'test',s.pid,s.customer,'501229','upgrade',
    (select id from public.plans where slug='starter'),(select id from public.plans where slug='pro'),
    '1451030',pg_temp.variant('starter'),'1451030',pg_temp.variant('pro'),now()+interval '10 days',
    now()-interval '35 days',s.owner_id,now()-interval '6 days','manual_review','plan_change_variant_unexpected')
  returning id into v_change;
  perform pg_temp.eq(pg_temp.expire(s.pid,s.customer,s.salon_id),'processed','expire with review change');
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'plan_change_unresolved','review change blocks');
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'pro'),'BILLING_RESUBSCRIBE_PLAN_CHANGE_UNRESOLVED','review change acquire');

  -- cancelled past end: an applied D snapshot of the provider's expired state is terminal evidence
  select * into s from pg_temp.mk('e1-snapshot');
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,s.salon_id,'starter','cancelled',now()-interval '6 days',null,now()+interval '1 minute'),
    'processed','cancel');
  update public.subscriptions set current_period_ends_at=now()-interval '3 hours' where id=s.sub_id;
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'terminal_state_unconfirmed','before snapshot');
  select * into r from public.plan_billing_subscription_recovery_v1('test',s.sub_id,s.pid,s.customer,'501229',true,
    '1451030',pg_temp.variant('starter'),'expired',true,null,null,null,null,now()-interval '3 hours',
    now()-interval '35 days',now()-interval '2 hours',now());
  perform pg_temp.eq(r.verdict,'eligible','snapshot plan');
  v_token := r.review_token;
  select * into r from public.apply_billing_subscription_recovery_v1('test',s.sub_id,s.pid,s.customer,'501229',true,
    '1451030',pg_temp.variant('starter'),'expired',true,null,null,null,null,now()-interval '3 hours',
    now()-interval '35 days',now()-interval '2 hours',v_token,'OPS-E1','e1 snapshot terminal evidence','tester',now());
  perform pg_temp.eq(r.outcome,'applied','snapshot apply');
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'eligible','snapshot evidence');
end $$;

-- ---------------------------------------------------------------- 4: C1 capacity, parked activation and D recovery
do $$
declare s record; v_r text; v_checkout uuid; v_event uuid; v_new_pid text := pg_temp.nid(); r record; v_emp uuid;
begin
  select * into s from pg_temp.mk('e1-capacity','pro',4);
  perform pg_temp.eq(pg_temp.expire(s.pid,s.customer,s.salon_id,'pro'),'processed','expire pro');
  -- Starter with 4 active employees: refused before any provider call, nothing written
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'starter'),'EMPLOYEE_OVER_TARGET_LIMIT','over target');
  if exists(select 1 from public.billing_checkout_sessions where salon_id=s.salon_id) then raise exception 'OVER_TARGET_WROTE'; end if;
  -- read-only owner can still deactivate (the trigger only guards activations)
  select id into v_emp from public.employees where salon_id=s.salon_id and is_active limit 1;
  update public.employees set is_active=false where id=v_emp;
  v_r := pg_temp.acq(s.salon_id,s.owner_id,'starter');
  if v_r not like 'created:%' then raise exception 'STARTER_AFTER_DEACTIVATION %',v_r; end if;
  v_checkout := pg_temp.acq_id(v_r);
  perform pg_temp.eq((select max_employees||':'||capacity_reason||':'||pending_plan_slug
    from public.resolve_employee_capacity_v2(s.salon_id)),'3:pending_checkout:starter','reservation');
  perform pg_temp.open_checkout(v_checkout);
  -- an employee re-activated behind the guard (simulated) makes the final activation park
  alter table public.employees disable trigger user;
  update public.employees set is_active=true where id=v_emp;
  alter table public.employees enable trigger user;
  v_event := pg_temp.created(v_checkout,v_new_pid,s.customer);
  perform pg_temp.eq(pg_temp.proc(v_event),'manual_review:processor_checkout_capacity_exceeded','parked for capacity');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'expired:pro:'||s.pid||':'||s.customer,'parked keeps old identity');
  if exists(select 1 from public.billing_subscription_provider_generations where subscription_id=s.sub_id) then
    raise exception 'PARKED_WROTE_HISTORY'; end if;
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'purchase_activation_pending','parked blocks new purchase');
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'pro'),'BILLING_PURCHASE_ACTIVATION_PENDING','parked acquire');
  -- D: still over capacity -> precondition; after deactivation -> token, then activation
  select * into r from public.plan_billing_event_reprocess_v1('test',v_event);
  perform pg_temp.eq(r.verdict||':'||coalesce(r.error_code,'-'),'precondition_unmet:recovery_target_capacity_exceeded','D over capacity');
  update public.employees set is_active=false where id=v_emp;
  select * into r from public.plan_billing_event_reprocess_v1('test',v_event);
  perform pg_temp.eq(r.verdict,'eligible','D eligible for own generation');
  select * into r from public.apply_billing_event_reprocess_v1('test',v_event,r.review_token,'OPS-E1','e1 parked resubscribe','tester');
  perform pg_temp.eq(r.outcome,'reprocessed','D activation');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'active:starter:'||v_new_pid||':'||s.customer,'D activated new identity');
  perform pg_temp.eq((select generation||':'||provider_subscription_id from public.billing_subscription_provider_generations
    where subscription_id=s.sub_id),'1:'||s.pid,'D kept history');
  perform pg_temp.eq((select max_employees||':'||capacity_reason from public.resolve_employee_capacity_v2(s.salon_id)),'3:plan','reservation moved to plan');
end $$;

-- ---------------------------------------------------------------- 5: expired replacement, late old intent, generation conflict
do $$
declare s record; v_r text; v_x1 uuid; v_x2 uuid; v_e1 uuid; v_e2 uuid; v_b text := pg_temp.nid(); v_c text := pg_temp.nid();
begin
  select * into s from pg_temp.mk('e1-replace');
  perform pg_temp.eq(pg_temp.expire(s.pid,s.customer,s.salon_id),'processed','expire');
  v_x1 := pg_temp.acq_id(pg_temp.acq(s.salon_id,s.owner_id,'starter'));
  perform pg_temp.open_checkout(v_x1, clock_timestamp()-interval '1 minute');   -- link already expired
  v_r := pg_temp.acq(s.salon_id,s.owner_id,'starter');
  if v_r not like 'created:%' then raise exception 'EXPIRED_REPLACEMENT %',v_r; end if;
  v_x2 := pg_temp.acq_id(v_r);
  perform pg_temp.eq((select status from public.billing_checkout_sessions where id=v_x1),'expired','old intent expired locally');
  perform pg_temp.eq((select resubscribe_from_provider_subscription_id||':'||resubscribe_from_generation
    from public.billing_checkout_sessions where id=v_x2),s.pid||':1','replacement bound to same generation');
  perform pg_temp.open_checkout(v_x2);
  -- the old intent was paid after all: its created arrives first and parks (not proven unpaid)
  v_e1 := pg_temp.created(v_x1,v_c,s.customer);
  perform pg_temp.eq(pg_temp.proc(v_e1),'manual_review:processor_checkout_state_invalid','late old intent parked');
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'purchase_activation_pending','late paid intent blocks');
  -- the replacement is paid too: it activates; the parked one can never replace the new identity
  v_e2 := pg_temp.created(v_x2,v_b,s.customer);
  perform pg_temp.eq(pg_temp.proc(v_e2),'processed','replacement activation');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'active:starter:'||v_b||':'||s.customer,'replacement identity');
  declare r record; begin
    select * into r from public.plan_billing_event_reprocess_v1('test',v_e1);
    perform pg_temp.eq(r.verdict||':'||coalesce(r.error_code,'-'),'conflict:recovery_resubscribe_generation_conflict','D refuses old generation');
  end;
  -- a fresh delivery for the old intent after the replacement is a generation conflict
  update public.billing_checkout_sessions set status='open' where id=v_x1;   -- even if it were open
  v_e1 := pg_temp.created(v_x1,v_c,s.customer);
  perform pg_temp.eq(pg_temp.proc(v_e1),'manual_review:processor_resubscribe_generation_conflict','generation conflict');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'active:starter:'||v_b||':'||s.customer,'unchanged after conflict');
end $$;

-- ---------------------------------------------------------------- 6: ambiguity, mismatches, provider trial
do $$
declare s record; v_checkout uuid; v_event uuid;
begin
  -- a signed event of an unknown provider subscription for this salon: may be a purchase
  select * into s from pg_temp.mk('e1-foreign');
  perform pg_temp.eq(pg_temp.expire(s.pid,s.customer,s.salon_id),'processed','expire');
  perform pg_temp.eq(pg_temp.upd(pg_temp.nid(),s.customer,s.salon_id,'starter','active',now()-interval '10 minutes',now()+interval '30 days',null),
    'manual_review:processor_updated_subscription_unknown','foreign subscription event');
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'purchase_activation_pending','foreign event blocks');

  -- completed ambiguity: a completed resubscribe of the current generation without the identity moving
  select * into s from pg_temp.mk('e1-completed-ambiguity');
  perform pg_temp.eq(pg_temp.expire(s.pid,s.customer,s.salon_id),'processed','expire');
  insert into public.billing_checkout_sessions(salon_id,actor_profile_id,requested_plan_id,provider,environment,
    idempotency_key,status,completed_at,resubscribe_from_provider_subscription_id,resubscribe_from_generation)
  values(s.salon_id,s.owner_id,(select id from public.plans where slug='starter'),'lemonsqueezy','test',
    gen_random_uuid(),'completed',now(),s.pid,1);
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'reconciliation_required','completed ambiguity');
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'starter'),'BILLING_RECONCILIATION_REQUIRED_RESUBSCRIBE_STATE','completed ambiguity acquire');

  -- the local state moves between the eligibility read and acquisition: acquisition re-checks under locks
  select * into s from pg_temp.mk('e1-stale-read');
  perform pg_temp.eq(pg_temp.expire(s.pid,s.customer,s.salon_id),'processed','expire');
  perform pg_temp.eq(pg_temp.elig(s.salon_id,s.owner_id),'eligible','read');
  insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,starts_at)
  select s.salon_id,id,'internal','e1 late override',now()-interval '1 minute' from public.plans where slug='pro';
  perform pg_temp.eq(pg_temp.acq(s.salon_id,s.owner_id,'starter'),'BILLING_OVERRIDE_ACTIVE','stale read refused');

  -- mismatched store / tenant correlation / provider trial on the new subscription
  select * into s from pg_temp.mk('e1-mismatch');
  perform pg_temp.eq(pg_temp.expire(s.pid,s.customer,s.salon_id),'processed','expire');
  v_checkout := pg_temp.acq_id(pg_temp.acq(s.salon_id,s.owner_id,'starter'));
  perform pg_temp.open_checkout(v_checkout);
  perform pg_temp.eq(pg_temp.proc(pg_temp.created(v_checkout,pg_temp.nid(),s.customer,'999999')),
    'manual_review:processor_provider_mapping_invalid','store mismatch');
  perform pg_temp.eq(pg_temp.proc(pg_temp.created(v_checkout,pg_temp.nid(),s.customer,'501229',null,gen_random_uuid())),
    'manual_review:processor_checkout_correlation_invalid','tenant mismatch');
  perform pg_temp.eq(pg_temp.proc(pg_temp.created(v_checkout,pg_temp.nid(),s.customer,'501229',now()+interval '14 days')),
    'manual_review:processor_provider_state_unsupported','provider trial refused');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'expired:starter:'||s.pid||':'||s.customer,'mismatches changed nothing');
  if exists(select 1 from public.billing_subscription_provider_generations where subscription_id=s.sub_id) then
    raise exception 'MISMATCH_WROTE_HISTORY'; end if;
  -- a new provider subscription id that is already the current identity of another salon
  declare o record; begin
    select * into o from pg_temp.mk('e1-other-owner');
    perform pg_temp.eq(pg_temp.proc(pg_temp.created(v_checkout,o.pid,s.customer)),
      'manual_review:processor_provider_ownership_conflict','foreign salon identity');
  end;
end $$;

-- ---------------------------------------------------------------- 7: D tokens go stale; old C2 evidence never completes a new change
do $$
declare s record; v_checkout uuid; v_new_pid text := pg_temp.nid(); r record; v_token text; v_change uuid;
  v_sub public.subscriptions; v_baseline timestamptz;
begin
  select * into s from pg_temp.mk('e1-tokens');
  perform pg_temp.eq(pg_temp.expire(s.pid,s.customer,s.salon_id),'processed','expire');
  -- dry-run against the old identity
  select * into r from public.plan_billing_subscription_recovery_v1('test',s.sub_id,s.pid,s.customer,'501229',true,
    '1451030',pg_temp.variant('starter'),'expired',true,null,null,null,null,now()-interval '2 hours',
    now()-interval '35 days',now()-interval '30 minutes',now());
  v_token := r.review_token;
  v_checkout := pg_temp.acq_id(pg_temp.acq(s.salon_id,s.owner_id,'pro'));
  perform pg_temp.open_checkout(v_checkout);
  perform pg_temp.eq(pg_temp.proc(pg_temp.created(v_checkout,v_new_pid,s.customer)),'processed','activate');
  select * into r from public.apply_billing_subscription_recovery_v1('test',s.sub_id,s.pid,s.customer,'501229',true,
    '1451030',pg_temp.variant('starter'),'expired',true,null,null,null,null,now()-interval '2 hours',
    now()-interval '35 days',now()-interval '30 minutes',v_token,'OPS-E1','e1 old token after generation','tester',now());
  if r.outcome = 'applied' then raise exception 'OLD_TOKEN_APPLIED'; end if;
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'active:pro:'||v_new_pid||':'||s.customer,'old token changed nothing');

  -- a confirmed change on the NEW identity waiting only for E3
  select * into v_sub from public.subscriptions where id=s.sub_id;
  v_baseline := v_sub.current_period_ends_at;
  insert into public.billing_subscription_plan_changes(subscription_id,salon_id,environment,provider_subscription_id,
    provider_customer_id,provider_store_id,direction,from_plan_id,target_plan_id,from_provider_product_id,
    from_provider_variant_id,target_provider_product_id,target_provider_variant_id,baseline_period_end,
    baseline_provider_updated_at,requested_by_profile_id,requested_at,status,confirmed_provider_updated_at,
    confirmed_source,confirmed_at,observed_provider_updated_at,observed_status,observed_product_id,
    observed_variant_id,observed_period_end,observed_source)
  values(s.sub_id,s.salon_id,'test',v_new_pid,s.customer,'501229','downgrade',
    (select id from public.plans where slug='pro'),(select id from public.plans where slug='starter'),
    '1451030',pg_temp.variant('pro'),'1451030',pg_temp.variant('starter'),v_baseline,
    v_sub.provider_state_updated_at - interval '2 seconds',s.owner_id,now(),'confirmed',
    v_sub.provider_state_updated_at - interval '1 second','webhook',now(),v_sub.provider_state_updated_at,
    'active','1451030',pg_temp.variant('starter'),v_baseline + interval '30 days','webhook')
  returning id into v_change;
  -- a paid renewal invoice of the OLD identity in the right time window is not E3 for the new change
  perform pg_temp.eq(pg_temp.inv(pg_temp.nid(),s.pid,s.customer,'renewal',v_baseline + interval '1 hour'),
    'invoice_evidence_recorded','old invoice');
  perform private.evaluate_billing_plan_change_v1(s.sub_id,now());
  perform pg_temp.eq((select status from public.billing_subscription_plan_changes where id=v_change),'confirmed','old invoice is not E3');
  -- the new identity's renewal completes it
  perform pg_temp.eq(pg_temp.inv(pg_temp.nid(),v_new_pid,s.customer,'renewal',v_baseline + interval '1 hour'),
    'invoice_evidence_recorded','new invoice');
  perform pg_temp.eq((select status from public.billing_subscription_plan_changes where id=v_change),'completed','new invoice is E3');
end $$;

rollback;
