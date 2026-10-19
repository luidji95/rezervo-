\set ON_ERROR_STOP on
begin;

-- C2 next-renewal plan change contract. Disposable database only (see
-- scripts/test-billing-c2-plan-change.mjs). Times are relative to the transaction start so the
-- employee trigger (which uses now()) and explicit p_now values agree.

create temp table c2_clock as select date_trunc('minute', now()) as t0;
create temp sequence c2_ids start 700001;

create function pg_temp.t(p interval default interval '0') returns timestamptz
language sql stable as $$ select t0 + p from c2_clock $$;
create function pg_temp.b(p interval default interval '0') returns timestamptz   -- baseline-relative
language sql stable as $$ select t0 + interval '30 days' + p from c2_clock $$;
create function pg_temp.eq(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'C2_ASSERT % expected=% actual=%', p_label, p_expected, p_actual;
  end if;
end $$;
create function pg_temp.err(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

-- catalogue (canonical numeric provider ids, as the invoice evidence contract requires)
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

create function pg_temp.variant(p_slug text) returns text language sql as $$
  select case p_slug when 'starter' then '2264918' when 'pro' then '2264940' else '2264999' end $$;

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
  pid := nextval('c2_ids')::text;
  customer := nextval('c2_ids')::text;
  update public.subscriptions set
    plan_id=(select id from public.plans where slug=p_slug),status='active',
    billing_provider='lemonsqueezy',billing_environment='test',
    provider_customer_id=customer,provider_subscription_id=pid,
    trial_starts_at=null,trial_ends_at=null,
    current_period_starts_at=pg_temp.t(interval '-1 day'),
    current_period_ends_at=pg_temp.b(),
    provider_state_updated_at=pg_temp.t(interval '-1 day') + interval '30 seconds',
    cancel_at_period_end=false,cancelled_at=null
  where id=sub_id;
  if p_employees > 0 then
    alter table public.employees disable trigger user;
    insert into public.employees(salon_id,full_name) select mk.salon_id,'E'||g from generate_series(1,p_employees) g;
    alter table public.employees enable trigger user;
  end if;
  return next;
end $$;

-- prepare + request with a fresh provider read that matches the local paid period
create function pg_temp.req(p_salon uuid, p_owner uuid, p_target text, p_now timestamptz default null,
  p_over jsonb default '{}') returns uuid
language plpgsql as $$
declare v_prep record; v_sub public.subscriptions; v_snap jsonb; v_id uuid; v_now timestamptz;
begin
  v_now := coalesce(p_now, pg_temp.t());
  select * into v_sub from public.subscriptions where salon_id=p_salon;
  select * into v_prep from public.prepare_billing_plan_change_v1(
    p_salon,p_owner,(select id from public.plans where slug=p_target),v_now);
  v_snap := jsonb_build_object('pid',v_sub.provider_subscription_id,'customer',v_sub.provider_customer_id,
    'store','501229','test_mode',true,'product','1451030',
    'variant',pg_temp.variant((select slug from public.plans where id=v_sub.plan_id)),
    'status','active','cancelled',false,'renews',v_sub.current_period_ends_at,
    'updated',v_sub.provider_state_updated_at,'checked',v_now - interval '1 minute',
    'token',coalesce(v_prep.state_token,'no-token')) || p_over;
  select plan_change_id into v_id from public.request_billing_plan_change_v1(
    p_salon,p_owner,(select id from public.plans where slug=p_target),
    v_snap->>'token',v_snap->>'pid',v_snap->>'customer',v_snap->>'store',(v_snap->>'test_mode')::boolean,
    v_snap->>'product',v_snap->>'variant',v_snap->>'status',(v_snap->>'cancelled')::boolean,null,null,
    (v_snap->>'renews')::timestamptz,(v_snap->>'ends')::timestamptz,(v_snap->>'updated')::timestamptz,
    (v_snap->>'checked')::timestamptz,v_now);
  return v_id;
end $$;

-- provider PATCH result / later read for a change
create function pg_temp.res(p_change uuid, p_result text, p_slug text default null, p_updated timestamptz default null,
  p_renews timestamptz default null, p_status text default 'active', p_ends timestamptz default null)
returns text
language plpgsql as $$
declare v_c public.billing_subscription_plan_changes; r record;
begin
  select * into v_c from public.billing_subscription_plan_changes where id=p_change;
  select * into r from public.record_billing_plan_change_provider_result_v1(
    'test',p_change,p_result,
    case when p_slug is null then null else v_c.provider_subscription_id end,
    case when p_slug is null then null else v_c.provider_customer_id end,
    case when p_slug is null then null else '501229' end,
    case when p_slug is null then null else true end,
    case when p_slug is null then null else '1451030' end,
    case when p_slug is null then null else pg_temp.variant(p_slug) end,
    case when p_slug is null then null else p_status end,
    case when p_slug is null then null else (p_status='cancelled') end,
    null,null,
    case when p_slug is null then null else coalesce(p_renews, v_c.baseline_period_end) end,
    p_ends, p_updated, coalesce(p_updated, pg_temp.t()) + interval '5 seconds');
  return r.plan_change_status;
end $$;

-- signed subscription_updated delivery through the real processor
create function pg_temp.upd(p_pid text, p_customer text, p_suffix text, p_slug text, p_status text,
  p_updated timestamptz, p_renews timestamptz, p_ends timestamptz, p_now timestamptz) returns text
language plpgsql as $$
declare v_id uuid; r record;
begin
  select event_id into v_id from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_updated','subscriptions',p_pid,
    encode(digest('c2-event-'||p_suffix,'sha256'),'hex'),encode(digest('c2-semantic-'||p_suffix,'sha256'),'hex'),
    'received',null,true,gen_random_uuid(),gen_random_uuid(),'starter',gen_random_uuid(),
    p_pid,'order-'||p_pid,p_customer,'1451030',pg_temp.variant(p_slug),p_status,
    pg_temp.t(interval '-1 day'),p_updated,true,'ready',null,'501229',p_renews,p_ends,
    p_status in ('cancelled','expired'),null,null,null);
  select * into r from public.process_billing_subscription_updated_v2(v_id,p_now);
  return r.outcome||coalesce(':'||r.error_code,'');
end $$;

-- signed subscription_payment_success delivery through the real ingest
create function pg_temp.inv(p_invoice text, p_pid text, p_customer text, p_reason text,
  p_created timestamptz, p_now timestamptz, p_store text default '501229') returns text
language sql as $$
  select outcome from public.ingest_billing_subscription_invoice_evidence_v1(
    'lemonsqueezy','test','subscription_payment_success','subscription-invoices',p_invoice,
    encode(digest('c2-invoice-'||p_invoice,'sha256'),'hex'),encode(digest('c2-invoice-sem-'||p_invoice,'sha256'),'hex'),
    true,p_invoice,p_pid,p_customer,p_store,p_reason,'paid',p_created,p_created + interval '20 seconds',p_now);
$$;

create function pg_temp.acc(p_salon uuid, p_now timestamptz) returns text language sql as $$
  select a.has_full_access||':'||a.effective_plan_slug||':'||a.access_reason
  from public.resolve_salon_access_v1(p_salon,p_now) a $$;
create function pg_temp.cap(p_salon uuid, p_now timestamptz default null) returns text language sql as $$
  select c.max_employees||':'||c.capacity_reason||':'||coalesce(c.pending_plan_slug,'-')
  from public.resolve_employee_capacity_v2(p_salon,coalesce(p_now,now())) c $$;
create function pg_temp.st(p_change uuid) returns text language sql as $$
  select status||coalesce(':'||conflict_code,'') from public.billing_subscription_plan_changes where id=p_change $$;
create function pg_temp.sub(p_salon uuid) returns text language sql as $$
  select p.slug||':'||s.status||':'||(s.current_period_ends_at=pg_temp.b())
  from public.subscriptions s join public.plans p on p.id=s.plan_id where s.salon_id=p_salon $$;
create function pg_temp.newinv() returns text language sql as $$ select nextval('c2_ids')::text $$;

-- ================================================================ 0. shape / ACL
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.prepare_billing_plan_change_v1(uuid,uuid,uuid,timestamptz)',
    'public.request_billing_plan_change_v1(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)',
    'public.record_billing_plan_change_provider_result_v1(text,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)',
    'public.evaluate_billing_plan_change_v1(text,uuid,timestamptz)'
  ] loop
    if has_function_privilege('anon',v_fn,'execute') or has_function_privilege('authenticated',v_fn,'execute')
       or not has_function_privilege('service_role',v_fn,'execute')
       or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                 where p.oid=v_fn::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')
       or not (select prosecdef from pg_proc where oid=v_fn::regprocedure)
       or (select proconfig from pg_proc where oid=v_fn::regprocedure) is distinct from array['search_path=""'] then
      raise exception 'C2_FUNCTION_ACL_INVALID %', v_fn;
    end if;
  end loop;
  if has_function_privilege('service_role','public.guard_subscription_plan_change_v1()','execute')
     or has_function_privilege('authenticated','public.guard_subscription_plan_change_v1()','execute') then
    raise exception 'C2_GUARD_FUNCTION_EXPOSED';
  end if;
  if has_table_privilege('service_role','public.billing_subscription_plan_changes','insert')
     or has_table_privilege('service_role','public.billing_subscription_plan_changes','update')
     or has_table_privilege('service_role','public.billing_subscription_plan_changes','delete')
     or not has_table_privilege('service_role','public.billing_subscription_plan_changes','select')
     or has_table_privilege('authenticated','public.billing_subscription_plan_changes','select')
     or has_table_privilege('anon','public.billing_subscription_plan_changes','select') then
    raise exception 'C2_TABLE_ACL_INVALID';
  end if;
  set local role authenticated;
  begin
    perform * from public.prepare_billing_plan_change_v1(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
    reset role; raise exception 'C2_AUTHENTICATED_CAN_PREPARE';
  exception when insufficient_privilege then reset role; end;
end $$;

-- ================================================================ 1. request guards
do $$
declare s record; o record; v_id uuid; v_token text;
begin
  select * into s from pg_temp.mk('guards');
  -- not the owner
  perform pg_temp.eq((select error_code from public.prepare_billing_plan_change_v1(
    s.salon_id,(select owner_id from pg_temp.mk('other-owner')),(select id from public.plans where slug='pro'),pg_temp.t())),
    'BILLING_PLAN_CHANGE_FORBIDDEN','forbidden');
  -- same plan
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L)',s.salon_id,s.owner_id,'starter')),
    'BILLING_PLAN_CHANGE_TARGET_INVALID','same plan');
  -- 48 h boundary: exactly 48 h left is refused, one second more is eligible
  update public.subscriptions set current_period_ends_at=pg_temp.t(interval '48 hours') where id=s.sub_id;
  perform pg_temp.eq((select error_code from public.prepare_billing_plan_change_v1(
    s.salon_id,s.owner_id,(select id from public.plans where slug='pro'),pg_temp.t())),
    'BILLING_PLAN_CHANGE_RENEWAL_TOO_CLOSE','48h refused');
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L)',s.salon_id,s.owner_id,'pro')),
    'BILLING_PLAN_CHANGE_RENEWAL_TOO_CLOSE','48h request refused');
  update public.subscriptions set current_period_ends_at=pg_temp.t(interval '48 hours 1 second') where id=s.sub_id;
  perform pg_temp.eq((select outcome from public.prepare_billing_plan_change_v1(
    s.salon_id,s.owner_id,(select id from public.plans where slug='pro'),pg_temp.t())),'eligible','48h+1s eligible');
  update public.subscriptions set current_period_ends_at=pg_temp.b() where id=s.sub_id;
  -- active override at request time
  insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,starts_at)
  select s.salon_id,id,'internal','c2 override guard',pg_temp.t(interval '-1 hour') from public.plans where slug='pro';
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L)',s.salon_id,s.owner_id,'pro')),
    'BILLING_PLAN_CHANGE_OVERRIDE_ACTIVE','override');
  delete from public.billing_access_overrides where salon_id=s.salon_id;
  -- past_due / cancelled / legacy
  update public.subscriptions set status='past_due' where id=s.sub_id;
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L)',s.salon_id,s.owner_id,'pro')),
    'BILLING_SUBSCRIPTION_PAYMENT_REQUIRED','past_due');
  update public.subscriptions set status='cancelled',cancel_at_period_end=true,cancelled_at=pg_temp.t() where id=s.sub_id;
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L)',s.salon_id,s.owner_id,'pro')),
    'BILLING_PLAN_CHANGE_SUBSCRIPTION_CANCELLED','cancelled');
  update public.subscriptions set status='active',cancel_at_period_end=false,cancelled_at=null where id=s.sub_id;
  -- environment parity
  update private.billing_runtime_config set environment='live';
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L)',s.salon_id,s.owner_id,'pro')),
    'BILLING_PLAN_CHANGE_ENVIRONMENT_MISMATCH','environment');
  update private.billing_runtime_config set environment='test';
  -- provider read must show exactly the local paid period on the from-plan
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L,null,%L)',s.salon_id,s.owner_id,'pro',
    jsonb_build_object('renews',pg_temp.b(interval '1 day')))),'BILLING_PLAN_CHANGE_PROVIDER_STATE_MISMATCH','renews mismatch');
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L,null,%L)',s.salon_id,s.owner_id,'pro',
    jsonb_build_object('variant','2264940'))),'BILLING_PLAN_CHANGE_PROVIDER_STATE_MISMATCH','already target variant');
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L,null,%L)',s.salon_id,s.owner_id,'pro',
    jsonb_build_object('updated',pg_temp.t(interval '-2 days')))),'BILLING_PLAN_CHANGE_PROVIDER_STATE_MISMATCH','provider read older than local');
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L,null,%L)',s.salon_id,s.owner_id,'pro',
    jsonb_build_object('checked',pg_temp.t(interval '-11 minutes')))),'BILLING_PLAN_CHANGE_PROVIDER_EVIDENCE_STALE','stale read');
  -- local state changed between prepare and request
  select state_token into v_token from public.prepare_billing_plan_change_v1(
    s.salon_id,s.owner_id,(select id from public.plans where slug='pro'),pg_temp.t());
  update public.subscriptions set provider_state_updated_at=provider_state_updated_at+interval '1 second' where id=s.sub_id;
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L,null,%L)',s.salon_id,s.owner_id,'pro',
    jsonb_build_object('token',v_token))),'BILLING_PLAN_CHANGE_STATE_CHANGED','token');
  -- valid request, then a duplicate is refused
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.eq(pg_temp.st(v_id),'requested','requested');
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L)',s.salon_id,s.owner_id,'pro')),
    'BILLING_PLAN_CHANGE_PENDING','duplicate');
  perform pg_temp.eq((select direction||':'||(baseline_period_end=pg_temp.b())::text from public.billing_subscription_plan_changes where id=v_id),
    'upgrade:true','baseline recorded');
  -- immutable evidence
  perform pg_temp.eq(pg_temp.err(format('update public.billing_subscription_plan_changes set baseline_period_end=baseline_period_end+interval %L where id=%L','1 day',v_id)),
    'BILLING_PLAN_CHANGE_IDENTITY_IMMUTABLE','baseline immutable');
  perform pg_temp.eq(pg_temp.err(format('delete from public.billing_subscription_plan_changes where id=%L',v_id)),
    'BILLING_PLAN_CHANGE_IMMUTABLE','no delete');
  -- downgrade precondition
  select * into o from pg_temp.mk('downgrade-over','pro',4);
  perform pg_temp.eq((select error_code from public.prepare_billing_plan_change_v1(
    o.salon_id,o.owner_id,(select id from public.plans where slug='starter'),pg_temp.t())),
    'EMPLOYEE_OVER_TARGET_LIMIT','downgrade over target (prepare)');
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L,null,%L)',o.salon_id,o.owner_id,'starter',
    jsonb_build_object('token',(select private.billing_subscription_state_fingerprint_v1(x) from public.subscriptions x where x.id=o.sub_id)))),
    'EMPLOYEE_OVER_TARGET_LIMIT','downgrade over target (request under capacity lock)');
end $$;

-- ================================================================ 2. upgrade, in order (E1 PATCH, E2 webhook, E3 invoice)
do $$
declare s record; v_id uuid; v_inv text;
begin
  select * into s from pg_temp.mk('upgrade-in-order','starter',2);
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  -- pre-baseline: existing paid Starter remains, capacity is not raised
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.t(interval '1 day')),'true:starter:active_period','pre-baseline access');
  perform pg_temp.eq(pg_temp.res(v_id,'accepted','pro',pg_temp.t(interval '5 seconds')),'confirmed','E1 from PATCH response');
  perform pg_temp.eq(pg_temp.cap(s.salon_id),'3:plan:-','upgrade does not raise capacity early');
  -- E1 webhook for the same provider version is consistent (already confirmed)
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'u2-e1','pro','active',pg_temp.t(interval '5 seconds'),pg_temp.b(),null,pg_temp.t(interval '10 seconds')),
    'processed','E1 webhook');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'starter:active:true','plan locked before boundary');
  -- E2: provider renewed, but without payment evidence the access period stays at the baseline
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'u2-e2','pro','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes')),
    'processed','E2 webhook');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'starter:active:true','period capped at baseline');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '3 minutes')),'false:starter:period_expired','no full access after baseline without payment');
  perform pg_temp.eq(pg_temp.st(v_id),'confirmed','awaiting payment');
  -- stale renewal invoice (before baseline) and non-renewal invoices do not complete
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'renewal',pg_temp.b(interval '-1 hour'),pg_temp.b(interval '4 minutes'));
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'updated',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '4 minutes'));
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'initial',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '4 minutes'));
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '4 minutes'),'501230');
  perform pg_temp.eq(pg_temp.st(v_id),'confirmed','unrelated invoices ignored');
  -- E3
  v_inv := pg_temp.newinv();
  perform pg_temp.eq(pg_temp.inv(v_inv,s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '5 minutes')),
    'invoice_evidence_recorded','E3 recorded');
  perform pg_temp.eq(pg_temp.st(v_id),'completed','completed');
  perform pg_temp.eq((select renewal_invoice_id from public.billing_subscription_plan_changes where id=v_id),v_inv,'completion invoice');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'pro:active:false','target plan with renewed period');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '6 minutes')),'true:pro:active_period','Pro after payment');
  perform pg_temp.eq(pg_temp.cap(s.salon_id),'10:plan:-','Pro capacity after completion');
  -- same delivery again: no duplicate effect
  perform pg_temp.eq(pg_temp.inv(v_inv,s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '7 minutes')),
    'invoice_evidence_already_recorded','duplicate delivery');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'pro:active:false','duplicate no effect');
  -- the next non-transition renewal follows the existing contract again
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'u2-next','pro','active',pg_temp.b(interval '1 month 1 minute'),pg_temp.b(interval '2 months'),null,pg_temp.b(interval '1 month 2 minutes')),
    'processed','post-completion renewal');
  perform pg_temp.eq((select (current_period_ends_at=pg_temp.b(interval '2 months'))::text from public.subscriptions where id=s.sub_id),'true','normal lifecycle resumes');
end $$;

-- ================================================================ 3. arrival orders converge (invoice first; E1 last)
do $$
declare s record; v_id uuid;
begin
  -- 3a: E1, then E3 before E2
  select * into s from pg_temp.mk('order-invoice-first');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'accepted','pro',pg_temp.t(interval '5 seconds'));
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '1 minute'));
  perform pg_temp.eq(pg_temp.st(v_id),'confirmed','3a invoice alone does not complete');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'starter:active:true','3a still capped');
  perform pg_temp.upd(s.pid,s.customer,'o3a-e2','pro','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes'));
  perform pg_temp.eq(pg_temp.st(v_id),'completed','3a completes on E2');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'pro:active:false','3a target');

  -- 3b: PATCH timed out; E2 and E3 arrive; the delayed E1 webhook arrives last (stale) and completes
  select * into s from pg_temp.mk('order-e1-last');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.eq(pg_temp.res(v_id,'ambiguous'),'unknown','3b timeout is unknown, never not_applied');
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'o3b-e2','pro','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes')),
    'processed','3b E2');
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '3 minutes'));
  perform pg_temp.eq(pg_temp.st(v_id),'unknown','3b no E1 yet: blocking');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '4 minutes')),'false:starter:period_expired','3b read-only without E1');
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'o3b-e1','pro','active',pg_temp.t(interval '5 seconds'),pg_temp.b(),null,pg_temp.b(interval '5 minutes')),
    'stale_ignored','3b late E1 is stale for lifecycle');
  perform pg_temp.eq(pg_temp.st(v_id),'completed','3b late E1 still confirms and completes');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'pro:active:false','3b target');

  -- 3c: an E1 candidate whose provider version is at/after the boundary is not E1
  select * into s from pg_temp.mk('e1-after-boundary');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  perform pg_temp.eq(pg_temp.res(v_id,'observed','pro',pg_temp.b(interval '1 second'),pg_temp.b()),'unknown','3c not before boundary');
end $$;

-- ================================================================ 4. insufficient evidence
do $$
declare s record; v_id uuid;
begin
  -- paid renewal invoice + renewed provider period, but the target was never confirmed
  select * into s from pg_temp.mk('no-confirmation');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.upd(s.pid,s.customer,'nc-e2','pro','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes'));
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '3 minutes'));
  perform pg_temp.eq(pg_temp.st(v_id),'requested','4a paid invoice without E1 does not complete');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '4 minutes')),'false:starter:period_expired','4a read-only');
  -- confirmed and paid, but no renewed lifecycle state yet
  select * into s from pg_temp.mk('no-renewal');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'accepted','pro',pg_temp.t(interval '5 seconds'));
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '3 minutes'));
  perform pg_temp.eq(pg_temp.st(v_id),'confirmed','4b invoice without E2');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '4 minutes')),'false:starter:period_expired','4b read-only');
  -- a provider HTTP read showing the renewed period is not E2 (lifecycle not applied)
  perform pg_temp.res(v_id,'observed','pro',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'));
  perform pg_temp.eq(pg_temp.st(v_id),'confirmed','4c provider read is not lifecycle E2');
  -- implausible renewed period
  perform pg_temp.upd(s.pid,s.customer,'nr-e2','pro','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '2 months'),null,pg_temp.b(interval '2 minutes'));
  perform pg_temp.eq(pg_temp.st(v_id),'manual_review:plan_change_renewal_period_unexpected','4d renewal period sanity');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'starter:active:true','4d manual_review keeps the cap');
end $$;

-- ================================================================ 5. invoice reuse, failed renewal and recovery
do $$
declare a record; b record; v_a uuid; v_b uuid; v_inv text;
begin
  select * into a from pg_temp.mk('reuse-a');
  v_a := pg_temp.req(a.salon_id,a.owner_id,'pro');
  perform pg_temp.res(v_a,'accepted','pro',pg_temp.t(interval '5 seconds'));
  perform pg_temp.upd(a.pid,a.customer,'r5a-e2','pro','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes'));
  v_inv := pg_temp.newinv();
  perform pg_temp.inv(v_inv,a.pid,a.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '3 minutes'));
  perform pg_temp.eq(pg_temp.st(v_a),'completed','5 a completed');
  -- an invoice of another subscription never completes this one
  select * into b from pg_temp.mk('reuse-b');
  v_b := pg_temp.req(b.salon_id,b.owner_id,'pro');
  perform pg_temp.res(v_b,'accepted','pro',pg_temp.t(interval '5 seconds'));
  perform pg_temp.upd(b.pid,b.customer,'r5b-e2','pro','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes'));
  perform pg_temp.eq(pg_temp.st(v_b),'confirmed','5 b not completed by a''s invoice');
  -- failed renewal: past_due keeps the cap (read-only), later recovery completes
  perform pg_temp.upd(b.pid,b.customer,'r5b-pd','pro','past_due',pg_temp.b(interval '2 minutes'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '3 minutes'));
  perform pg_temp.eq(pg_temp.sub(b.salon_id),'starter:past_due:true','5 past_due capped');
  perform pg_temp.eq(pg_temp.acc(b.salon_id,pg_temp.b(interval '4 minutes')),'false:starter:past_due','5 past_due read-only');
  perform pg_temp.inv(pg_temp.newinv(),b.pid,b.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '2 days'));
  perform pg_temp.eq(pg_temp.st(v_b),'confirmed','5 paid invoice while past_due does not complete');
  perform pg_temp.upd(b.pid,b.customer,'r5b-rec','pro','active',pg_temp.b(interval '2 days 1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 days 2 minutes'));
  perform pg_temp.eq(pg_temp.st(v_b),'completed','5 recovery completes');
  perform pg_temp.eq(pg_temp.sub(b.salon_id),'pro:active:false','5 target after recovery');
end $$;

-- ================================================================ 6. downgrade, capacity, override after request
do $$
declare s record; v_id uuid;
begin
  select * into s from pg_temp.mk('downgrade','pro',3);
  v_id := pg_temp.req(s.salon_id,s.owner_id,'starter');
  perform pg_temp.eq(pg_temp.cap(s.salon_id),'3:pending_plan_change:starter','pending downgrade narrows capacity');
  perform pg_temp.eq(pg_temp.err(format('insert into public.employees(salon_id,full_name) values(%L,%L)',s.salon_id,'fourth')),
    'EMPLOYEE_PLAN_CHANGE_LIMIT_PENDING','activation over target refused');
  -- read-only deactivation stays possible; reactivation goes through the same authority
  update public.employees set is_active=false where id=(select id from public.employees where salon_id=s.salon_id order by full_name limit 1);
  perform pg_temp.eq(pg_temp.err(format('update public.employees set is_active=true where salon_id=%L and not is_active',s.salon_id)),'ok','reactivation within target');
  -- override granted after the request keeps its access but not a wider employee limit
  insert into public.billing_access_overrides(salon_id,plan_id,override_type,reason,starts_at)
  select s.salon_id,id,'internal','c2 override after request',pg_temp.t(interval '-1 hour') from public.plans where slug='pro';
  perform pg_temp.eq(pg_temp.cap(s.salon_id),'3:pending_plan_change:starter','override does not bypass the target reservation');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.t()),'true:pro:billing_override','override access priority unchanged');
  delete from public.billing_access_overrides where salon_id=s.salon_id;
  -- Pro stays until the baseline; after it, read-only until the Starter renewal is paid
  perform pg_temp.res(v_id,'accepted','starter',pg_temp.t(interval '5 seconds'));
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '-1 minute')),'true:pro:active_period','Pro until baseline');
  perform pg_temp.upd(s.pid,s.customer,'d6-e2','starter','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes'));
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '3 minutes')),'false:pro:period_expired','no Pro and no new Starter period without payment');
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '4 minutes'));
  perform pg_temp.eq(pg_temp.st(v_id),'completed','downgrade completed');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '5 minutes')),'true:starter:active_period','Starter period after payment');
  perform pg_temp.eq(pg_temp.cap(s.salon_id),'3:plan:-','Starter plan limit after completion');
end $$;

-- ================================================================ 7. cancel / resume / expired, rejected, guard, conflicts
do $$
declare s record; v_id uuid;
begin
  -- cancel before baseline keeps the paid remainder; resume continues; expiry abandons
  select * into s from pg_temp.mk('cancel-resume');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'accepted','pro',pg_temp.t(interval '5 seconds'));
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'c7-cancel','pro','cancelled',pg_temp.t(interval '1 day'),null,pg_temp.b(),pg_temp.t(interval '1 day 1 minute')),
    'processed','cancel processed');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.t(interval '2 days')),'true:starter:cancelled_until_period_end','cancel keeps paid remainder');
  perform pg_temp.eq(pg_temp.st(v_id),'confirmed','cancel keeps the pending contract');
  perform pg_temp.upd(s.pid,s.customer,'c7-resume','pro','active',pg_temp.t(interval '3 days'),pg_temp.b(),null,pg_temp.t(interval '3 days 1 minute'));
  perform pg_temp.eq(pg_temp.st(v_id),'confirmed','resume continues');
  perform pg_temp.upd(s.pid,s.customer,'c7-cancel2','pro','cancelled',pg_temp.t(interval '4 days'),null,pg_temp.b(),pg_temp.t(interval '4 days 1 minute'));
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'c7-expired','pro','expired',pg_temp.b(interval '1 minute'),null,pg_temp.b(),pg_temp.b(interval '2 minutes')),
    'processed','expired processed');
  perform pg_temp.eq(pg_temp.st(v_id),'abandoned','expired abandons');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '3 minutes')),'false:starter:expired','expired read-only');
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'c7-react','pro','active',pg_temp.b(interval '5 minutes'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '6 minutes')),
    'manual_review:processor_updated_plan_change_unsupported','terminal row does not re-open access');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '7 minutes')),'false:starter:expired','still read-only after terminal row');

  -- definitive provider rejection of an untouched request
  select * into s from pg_temp.mk('rejected','pro',1);
  v_id := pg_temp.req(s.salon_id,s.owner_id,'starter');
  perform pg_temp.eq(pg_temp.res(v_id,'rejected'),'not_applied','rejected');
  perform pg_temp.eq(pg_temp.cap(s.salon_id),'10:plan:-','reservation released');
  perform pg_temp.eq(pg_temp.err(format('select * from public.record_billing_plan_change_provider_result_v1(%L,%L,%L,null,null,null,null,null,null,null,null,null,null,null,null,null)','test',v_id,'accepted')),
    'ok','not_pending is a no-op');

  -- an accepted PATCH response that still shows the previous variant is not a confirmation
  select * into s from pg_temp.mk('accepted-old-variant');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.eq(pg_temp.res(v_id,'accepted','starter',pg_temp.t(interval '5 seconds')),'unknown','accepted without target is unknown');

  -- one PATCH attempt only; timeout stays blocking
  select * into s from pg_temp.mk('one-attempt');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.res(%L,%L,%L,%L)',v_id,'accepted','pro',pg_temp.t(interval '5 seconds'))),
    'BILLING_PLAN_CHANGE_ATTEMPT_ALREADY_RECORDED','no second attempt');
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.req(%L,%L,%L)',s.salon_id,s.owner_id,'pro')),'BILLING_PLAN_CHANGE_PENDING','unknown blocks new request');
  perform pg_temp.eq(pg_temp.res(v_id,'observed','pro',pg_temp.t(interval '6 seconds')),'confirmed','later provider read resolves unknown');

  -- direct writers cannot bypass the paid-access guard
  perform pg_temp.eq(pg_temp.err(format('update public.subscriptions set current_period_ends_at=%L where id=%L',pg_temp.b(interval '1 day'),s.sub_id)),
    'BILLING_PLAN_CHANGE_GUARD_PERIOD_CAPPED','guard period');
  perform pg_temp.eq(pg_temp.err(format('update public.subscriptions set plan_id=(select id from public.plans where slug=%L) where id=%L','pro',s.sub_id)),
    'BILLING_PLAN_CHANGE_GUARD_PLAN_LOCKED','guard plan');

  -- unexpected variant: event and change go to manual review; the cap persists
  select * into s from pg_temp.mk('unexpected');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'accepted','pro',pg_temp.t(interval '5 seconds'));
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'x7-other','other','active',pg_temp.t(interval '1 day'),pg_temp.b(),null,pg_temp.t(interval '1 day 1 minute')),
    'manual_review:processor_updated_provider_mapping_invalid','unexpected variant event');
  perform pg_temp.eq(pg_temp.st(v_id),'manual_review:plan_change_variant_unexpected','unexpected variant change');
  perform pg_temp.upd(s.pid,s.customer,'x7-e2','pro','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes'));
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '3 minutes'));
  perform pg_temp.eq(pg_temp.st(v_id),'manual_review:plan_change_variant_unexpected','manual_review never completes automatically');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'starter:active:true','manual_review keeps the cap');

  -- reverted to the previous variant after confirmation (arrives before E1 is recorded)
  select * into s from pg_temp.mk('reverted');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  perform pg_temp.upd(s.pid,s.customer,'v7-rev','starter','active',pg_temp.t(interval '2 days'),pg_temp.b(),null,pg_temp.t(interval '2 days 1 minute'));
  perform pg_temp.upd(s.pid,s.customer,'v7-e1','pro','active',pg_temp.t(interval '1 day'),pg_temp.b(),null,pg_temp.t(interval '2 days 2 minutes'));
  perform pg_temp.eq(pg_temp.st(v_id),'manual_review:plan_change_variant_reverted','revert detected regardless of order');

  -- provider renewed on the previous plan before the change landed
  select * into s from pg_temp.mk('renewed-old');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  perform pg_temp.upd(s.pid,s.customer,'ro7','starter','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes'));
  perform pg_temp.eq(pg_temp.st(v_id),'manual_review:plan_change_renewed_on_previous_plan','renewed on previous plan');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '3 minutes')),'false:starter:period_expired','renewal race stays read-only');

  -- same-timestamp conflict rule is unchanged
  select * into s from pg_temp.mk('same-ts');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.upd(s.pid,s.customer,'st7-a','pro','active',pg_temp.t(interval '1 day'),pg_temp.b(),null,pg_temp.t(interval '1 day 1 minute'));
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'st7-b','pro','cancelled',pg_temp.t(interval '1 day'),null,pg_temp.b(),pg_temp.t(interval '1 day 2 minutes')),
    'manual_review:processor_updated_same_timestamp_conflict','same timestamp conflict');
end $$;

-- ================================================================ 8. D snapshot recovery: same gate, token covers the change, parity
do $$
declare w record; d record; v_w uuid; v_d uuid; v_verdict text; v_token text; v_out text;
begin
  select * into w from pg_temp.mk('parity-webhook');
  select * into d from pg_temp.mk('parity-snapshot');
  v_w := pg_temp.req(w.salon_id,w.owner_id,'pro');
  v_d := pg_temp.req(d.salon_id,d.owner_id,'pro');
  perform pg_temp.res(v_w,'accepted','pro',pg_temp.t(interval '5 seconds'));
  perform pg_temp.res(v_d,'accepted','pro',pg_temp.t(interval '5 seconds'));

  -- dry-run, then the change state moves: the reviewed token is stale
  select r.verdict, r.review_token into v_verdict, v_token
  from public.plan_billing_subscription_recovery_v1('test',d.sub_id,d.pid,d.customer,'501229',true,'1451030','2264940','active',false,
    null,null,null,pg_temp.b(interval '1 month'),null,pg_temp.t(interval '-1 day'),pg_temp.b(interval '1 minute'),pg_temp.b(interval '2 minutes')) r;
  perform pg_temp.eq(v_verdict,'eligible','snapshot eligible');
  perform pg_temp.inv(pg_temp.newinv(),d.pid,d.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '90 seconds'));
  -- invoice evidence alone did not change the change row (awaiting renewal), so re-plan to be safe
  select r.review_token into v_token
  from public.plan_billing_subscription_recovery_v1('test',d.sub_id,d.pid,d.customer,'501229',true,'1451030','2264940','active',false,
    null,null,null,pg_temp.b(interval '1 month'),null,pg_temp.t(interval '-1 day'),pg_temp.b(interval '1 minute'),pg_temp.b(interval '2 minutes')) r;
  perform pg_temp.res(v_d,'observed','pro',pg_temp.t(interval '6 seconds'));
  select outcome into v_out from public.apply_billing_subscription_recovery_v1('test',d.sub_id,d.pid,d.customer,'501229',true,'1451030','2264940','active',false,
    null,null,null,pg_temp.b(interval '1 month'),null,pg_temp.t(interval '-1 day'),pg_temp.b(interval '1 minute'),
    v_token,'OPS-C2','c2 snapshot parity apply','c2-test',pg_temp.b(interval '2 minutes'));
  perform pg_temp.eq(v_out,'stale','token covers the plan-change state');

  -- snapshot without E3 never extends access or assigns the target
  select * into w from pg_temp.mk('snapshot-no-e3');
  v_w := pg_temp.req(w.salon_id,w.owner_id,'pro');
  perform pg_temp.res(v_w,'accepted','pro',pg_temp.t(interval '5 seconds'));
  select r.review_token into v_token
  from public.plan_billing_subscription_recovery_v1('test',w.sub_id,w.pid,w.customer,'501229',true,'1451030','2264940','active',false,
    null,null,null,pg_temp.b(interval '1 month'),null,pg_temp.t(interval '-1 day'),pg_temp.b(interval '1 minute'),pg_temp.b(interval '2 minutes')) r;
  perform pg_temp.eq((select (proposed_period_ends_at=pg_temp.b())::text from public.plan_billing_subscription_recovery_v1('test',w.sub_id,w.pid,w.customer,'501229',true,'1451030','2264940','active',false,
    null,null,null,pg_temp.b(interval '1 month'),null,pg_temp.t(interval '-1 day'),pg_temp.b(interval '1 minute'),pg_temp.b(interval '2 minutes'))),'true','dry-run proposes the capped period');
  select outcome into v_out from public.apply_billing_subscription_recovery_v1('test',w.sub_id,w.pid,w.customer,'501229',true,'1451030','2264940','active',false,
    null,null,null,pg_temp.b(interval '1 month'),null,pg_temp.t(interval '-1 day'),pg_temp.b(interval '1 minute'),
    v_token,'OPS-C2','c2 snapshot without payment','c2-test',pg_temp.b(interval '2 minutes'));
  perform pg_temp.eq(v_out,'applied','snapshot applied');
  perform pg_temp.eq(pg_temp.sub(w.salon_id),'starter:active:true','snapshot capped, plan unchanged');
  perform pg_temp.eq(pg_temp.st(v_w),'confirmed','snapshot alone does not complete');
  perform pg_temp.eq(pg_temp.acc(w.salon_id,pg_temp.b(interval '3 minutes')),'false:starter:period_expired','snapshot gives no new period');
  -- after payment evidence the same evaluator completes
  perform pg_temp.inv(pg_temp.newinv(),w.pid,w.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '4 minutes'));
  perform pg_temp.eq(pg_temp.st(v_w),'completed','snapshot + E3 completes');

  -- webhook vs snapshot parity on identical salons: same final subscription and change state
  select * into w from pg_temp.mk('parity2-webhook');
  select * into d from pg_temp.mk('parity2-snapshot');
  v_w := pg_temp.req(w.salon_id,w.owner_id,'pro');
  v_d := pg_temp.req(d.salon_id,d.owner_id,'pro');
  perform pg_temp.res(v_w,'accepted','pro',pg_temp.t(interval '5 seconds'));
  perform pg_temp.res(v_d,'accepted','pro',pg_temp.t(interval '5 seconds'));
  perform pg_temp.inv(pg_temp.newinv(),w.pid,w.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '90 seconds'));
  perform pg_temp.inv(pg_temp.newinv(),d.pid,d.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '90 seconds'));
  perform pg_temp.upd(w.pid,w.customer,'p8-e2','pro','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes'));
  select r.review_token into v_token
  from public.plan_billing_subscription_recovery_v1('test',d.sub_id,d.pid,d.customer,'501229',true,'1451030','2264940','active',false,
    null,null,null,pg_temp.b(interval '1 month'),null,pg_temp.t(interval '-1 day'),pg_temp.b(interval '1 minute'),pg_temp.b(interval '2 minutes')) r;
  perform public.apply_billing_subscription_recovery_v1('test',d.sub_id,d.pid,d.customer,'501229',true,'1451030','2264940','active',false,
    null,null,null,pg_temp.b(interval '1 month'),null,pg_temp.t(interval '-1 day'),pg_temp.b(interval '1 minute'),
    v_token,'OPS-C2','c2 snapshot parity apply','c2-test',pg_temp.b(interval '2 minutes'));
  perform pg_temp.eq(pg_temp.st(v_d),pg_temp.st(v_w),'parity change status');
  perform pg_temp.eq(pg_temp.sub(d.salon_id),pg_temp.sub(w.salon_id),'parity subscription');
  perform pg_temp.eq(pg_temp.acc(d.salon_id,pg_temp.b(interval '3 minutes')),pg_temp.acc(w.salon_id,pg_temp.b(interval '3 minutes')),'parity access');
  perform pg_temp.eq(pg_temp.st(v_w),'completed','parity completed');

  -- unexpected variant via snapshot apply marks the change, like the processor
  select * into w from pg_temp.mk('snapshot-unexpected');
  v_w := pg_temp.req(w.salon_id,w.owner_id,'pro');
  select r.verdict, r.review_token into v_verdict, v_token
  from public.plan_billing_subscription_recovery_v1('test',w.sub_id,w.pid,w.customer,'501229',true,'1451030','2264999','active',false,
    null,null,null,pg_temp.b(),null,pg_temp.t(interval '-1 day'),pg_temp.t(interval '1 day'),pg_temp.t(interval '1 day 1 minute')) r;
  perform pg_temp.eq(v_verdict,'mapping_conflict','snapshot unexpected verdict (same as processor mapping_invalid)');
  perform public.apply_billing_subscription_recovery_v1('test',w.sub_id,w.pid,w.customer,'501229',true,'1451030','2264999','active',false,
    null,null,null,pg_temp.b(),null,pg_temp.t(interval '-1 day'),pg_temp.t(interval '1 day'),
    v_token,'OPS-C2','c2 snapshot unexpected variant','c2-test',pg_temp.t(interval '1 day 1 minute'));
  perform pg_temp.eq(pg_temp.st(v_w),'manual_review:plan_change_variant_unexpected','snapshot conflict marks change');
end $$;

-- ================================================================ 9. non-transition lifecycle unchanged
do $$
declare s record;
begin
  select * into s from pg_temp.mk('no-change-renewal');
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'n9','starter','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes')),
    'processed','non-transition renewal');
  perform pg_temp.eq((select (current_period_ends_at=pg_temp.b(interval '1 month'))::text from public.subscriptions where id=s.sub_id),'true','existing renewal contract kept');
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'n9-pro','pro','active',pg_temp.b(interval '3 minutes'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '4 minutes')),
    'manual_review:processor_updated_plan_change_unsupported','plan change without a request still unsupported');
  perform pg_temp.eq(pg_temp.cap(s.salon_id),'3:plan:-','capacity without change');
end $$;

-- ================================================================ 10. review regressions
-- 10a. completion is atomic: a failure while lifting the cap rolls back the invoice evidence,
--      the change outcome and every subscription write.
create function pg_temp.fail_plan_flip() returns trigger language plpgsql as $$
begin
  if new.plan_id is distinct from old.plan_id then raise exception 'C2_INJECTED_COMPLETION_FAILURE'; end if;
  return new;
end $$;
do $$
declare s record; v_id uuid; v_inv text; v_err text;
begin
  select * into s from pg_temp.mk('atomic-completion');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'accepted','pro',pg_temp.t(interval '5 seconds'));
  perform pg_temp.upd(s.pid,s.customer,'a10-e2','pro','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes'));
  create trigger c2_injected_failure before update on public.subscriptions
    for each row execute function pg_temp.fail_plan_flip();
  v_inv := pg_temp.newinv();
  v_err := pg_temp.err(format('select pg_temp.inv(%L,%L,%L,%L,%L,%L)',v_inv,s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '3 minutes')));
  perform pg_temp.eq(v_err,'C2_INJECTED_COMPLETION_FAILURE','10a injected failure surfaced');
  drop trigger c2_injected_failure on public.subscriptions;
  perform pg_temp.eq(pg_temp.st(v_id),'confirmed','10a change outcome rolled back');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'starter:active:true','10a subscription rolled back');
  perform pg_temp.eq((select count(*)::text from public.billing_webhook_subscription_invoice_facts where provider_invoice_id=v_inv),'0','10a invoice evidence rolled back');
  perform pg_temp.eq(pg_temp.inv(v_inv,s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '4 minutes')),'invoice_evidence_recorded','10a redelivery');
  perform pg_temp.eq(pg_temp.st(v_id),'completed','10a redelivery completes');
  -- 10b. the same invoice cannot complete a second change (database constraint, not only the evaluator)
  perform pg_temp.eq(pg_temp.err(format(
    'insert into public.billing_subscription_plan_changes(subscription_id,salon_id,environment,provider_subscription_id,provider_customer_id,provider_store_id,direction,from_plan_id,target_plan_id,from_provider_product_id,from_provider_variant_id,target_provider_product_id,target_provider_variant_id,baseline_period_end,baseline_provider_updated_at,requested_by_profile_id,requested_at,status,confirmed_provider_updated_at,renewal_invoice_id,completed_period_end) select subscription_id,salon_id,environment,provider_subscription_id,provider_customer_id,provider_store_id,direction,from_plan_id,target_plan_id,from_provider_product_id,from_provider_variant_id,target_provider_product_id,target_provider_variant_id,baseline_period_end,baseline_provider_updated_at,requested_by_profile_id,requested_at,%L,confirmed_provider_updated_at,renewal_invoice_id,completed_period_end from public.billing_subscription_plan_changes where id=%L','completed',v_id)),
    'duplicate key value violates unique constraint "billing_plan_changes_invoice_unique_idx"','10b invoice used once');
  -- 10c. a completed change blocks neither the next regular renewal nor a new allowed change
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'a10-next','pro','active',pg_temp.b(interval '1 month 1 minute'),pg_temp.b(interval '2 months'),null,pg_temp.b(interval '1 month 2 minutes')),
    'processed','10c regular renewal after completion');
  perform pg_temp.eq((select (current_period_ends_at=pg_temp.b(interval '2 months'))::text from public.subscriptions where id=s.sub_id),'true','10c renewal extends normally');
  perform pg_temp.eq(pg_temp.st(pg_temp.req(s.salon_id,s.owner_id,'starter',pg_temp.b(interval '1 month 5 minutes'))),'requested','10c new change allowed');
end $$;

-- 10d. not_applied is terminal without leaving a path to unproven rights: a later target state is
--      an unsupported plan change and does not extend the period.
do $$
declare s record; v_id uuid;
begin
  select * into s from pg_temp.mk('not-applied-late-target');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.eq(pg_temp.res(v_id,'rejected'),'not_applied','10d rejected');
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'na10','pro','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes')),
    'manual_review:processor_updated_plan_change_unsupported','10d late target after not_applied');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'starter:active:true','10d period not extended');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '3 minutes')),'false:starter:period_expired','10d read-only');
end $$;

-- 10e. E1 provider-timestamp precision (provider updated_at against provider updated_at; never local read time)
do $$
declare s record; v_id uuid; v_base timestamptz;
begin
  -- equal to the pre-request provider version with the target variant: not provable order -> fail closed
  select * into s from pg_temp.mk('e1-equal-timestamp');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  select baseline_provider_updated_at into v_base from public.billing_subscription_plan_changes where id=v_id;
  perform pg_temp.eq(pg_temp.res(v_id,'accepted','pro',v_base),'manual_review','10e equal timestamp with changed variant');
  perform pg_temp.eq(pg_temp.st(v_id),'manual_review:plan_change_evidence_order_conflict','10e equal timestamp conflict code');
  -- equal timestamp with the previous variant is only the pre-request state
  select * into s from pg_temp.mk('e1-equal-old-variant');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  select baseline_provider_updated_at into v_base from public.billing_subscription_plan_changes where id=v_id;
  perform pg_temp.eq(pg_temp.res(v_id,'accepted','starter',v_base),'unknown','10e equal timestamp, previous variant');
  -- one provider second newer confirms
  select * into s from pg_temp.mk('e1-newer-second');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  select baseline_provider_updated_at into v_base from public.billing_subscription_plan_changes where id=v_id;
  perform pg_temp.eq(pg_temp.res(v_id,'accepted','pro',v_base + interval '1 second'),'confirmed','10e newer provider second');
  -- E1 webhook delivered after the boundary but carrying a pre-boundary provider version: the
  -- lifecycle part is refused (renews_at already passed), the confirmation still counts
  select * into s from pg_temp.mk('e1-late-delivery');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'ld10-e1','pro','active',pg_temp.t(interval '5 seconds'),pg_temp.b(),null,pg_temp.b(interval '1 hour')),
    'manual_review:processor_updated_provider_state_unsupported','10e late E1 lifecycle refused');
  perform pg_temp.eq(pg_temp.st(v_id),'confirmed','10e late E1 confirmation recorded');
  perform pg_temp.upd(s.pid,s.customer,'ld10-e2','pro','active',pg_temp.b(interval '61 minutes'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '62 minutes'));
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '63 minutes'));
  perform pg_temp.eq(pg_temp.st(v_id),'completed','10e late E1 then E2/E3 completes');
  -- target snapshot after the boundary without pre-boundary evidence stays unresolved and read-only
  select * into s from pg_temp.mk('e1-post-boundary-only');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  perform pg_temp.res(v_id,'observed','pro',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'));
  perform pg_temp.upd(s.pid,s.customer,'pb10','pro','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes'));
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '3 minutes'));
  perform pg_temp.eq(pg_temp.st(v_id),'unknown','10e post-boundary target without E1');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '4 minutes')),'false:starter:period_expired','10e read-only');
end $$;

-- 10f. provider-result recording is idempotent for the same result; a different second result is refused
do $$
declare s record; v_id uuid;
begin
  select * into s from pg_temp.mk('result-replay');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.eq(pg_temp.res(v_id,'accepted','pro',pg_temp.t(interval '5 seconds')),'confirmed','10f first');
  perform pg_temp.eq(pg_temp.res(v_id,'accepted','pro',pg_temp.t(interval '5 seconds')),'confirmed','10f replay of the same result');
  perform pg_temp.eq((select attempt_count::text from public.billing_subscription_plan_changes where id=v_id),'1','10f one attempt');
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.res(%L,%L)',v_id,'ambiguous')),'BILLING_PLAN_CHANGE_ATTEMPT_ALREADY_RECORDED','10f conflicting second result');
  select * into s from pg_temp.mk('ambiguous-replay');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.eq(pg_temp.res(v_id,'ambiguous'),'unknown','10f ambiguous');
  perform pg_temp.eq(pg_temp.res(v_id,'ambiguous'),'unknown','10f ambiguous replay');
end $$;

-- 10g. D event-reprocess token covers the plan-change state
do $$
declare s record; v_event uuid; v_t1 text; v_t2 text;
begin
  select * into s from pg_temp.mk('event-token');
  update public.subscriptions set provider_subscription_id=s.pid||'-tmp' where id=s.sub_id;
  select event_id into v_event from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_updated','subscriptions',s.pid,
    encode(digest('c2-evtok','sha256'),'hex'),encode(digest('c2-evtok-sem','sha256'),'hex'),
    'received',null,true,gen_random_uuid(),gen_random_uuid(),'starter',gen_random_uuid(),
    s.pid,'order-'||s.pid,s.customer,'1451030','2264918','active',pg_temp.t(interval '-1 day'),pg_temp.t(interval '1 hour'),
    true,'ready',null,'501229',pg_temp.b(),null,false,null,null,null);
  perform public.process_billing_subscription_updated_v2(v_event,pg_temp.t(interval '2 hours'));
  update public.subscriptions set provider_subscription_id=s.pid where id=s.sub_id;
  select review_token into v_t1 from public.plan_billing_event_reprocess_v1('test',v_event,pg_temp.t(interval '2 hours'));
  perform pg_temp.req(s.salon_id,s.owner_id,'pro');
  select review_token into v_t2 from public.plan_billing_event_reprocess_v1('test',v_event,pg_temp.t(interval '2 hours'));
  if v_t1 is null or v_t1 = v_t2 then raise exception 'C2_ASSERT 10g event token does not cover the change'; end if;
  perform pg_temp.eq((select outcome from public.apply_billing_event_reprocess_v1('test',v_event,v_t1,'OPS-C2','c2 stale event token','c2-test',pg_temp.t(interval '2 hours'))),
    'stale','10g old token refused');
end $$;

-- 10h. service_role cannot write the evidence or reach private helpers; a direct subscription
--      write cannot extend the capped period (guard or ACL refuses)
do $$
declare s record; v_id uuid; v_err text;
begin
  if has_function_privilege('service_role','private.evaluate_billing_plan_change_v1(uuid,timestamptz)','execute')
     or has_function_privilege('service_role','private.observe_billing_plan_change_v1(uuid,text,text,text,text,text,timestamptz,timestamptz,timestamptz,boolean,timestamptz)','execute')
     or has_function_privilege('service_role','private.mark_billing_plan_change_review_v1(uuid,text)','execute') then
    raise exception 'C2_ASSERT 10h private helper exposed';
  end if;
  select * into s from pg_temp.mk('service-role-direct');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  set local role service_role;
  begin
    update public.billing_subscription_plan_changes set status='completed' where id=v_id;
    v_err := 'ok';
  exception when others then v_err := sqlerrm; end;
  begin
    update public.subscriptions set current_period_ends_at=pg_temp.b(interval '1 month') where id=s.sub_id;
    v_err := v_err||'|ok';
  exception when others then v_err := v_err||'|'||sqlerrm; end;
  reset role;
  if v_err like 'ok%' or v_err like '%|ok' then raise exception 'C2_ASSERT 10h service_role bypass: %', v_err; end if;
  perform pg_temp.eq(pg_temp.st(v_id),'requested','10h change untouched');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'starter:active:true','10h period untouched');
end $$;

rollback;
\echo 'Billing C2 plan change contract passed.'
