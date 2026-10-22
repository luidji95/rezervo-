\set ON_ERROR_STOP on
begin;

-- C2 operator recovery contract. Disposable database only (see
-- scripts/test-billing-c2-operator-recovery.mjs). Fixtures mirror the C2 plan change contract. Times are relative to the transaction start so the
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

-- recovery helpers: one validated provider snapshot per call
create function pg_temp.snap(p_change uuid, p_slug text, p_updated timestamptz, p_renews timestamptz default null,
  p_status text default 'active', p_ends timestamptz default null, p_over jsonb default '{}') returns jsonb
language sql as $$
  select jsonb_build_object('pid',c.provider_subscription_id,'customer',c.provider_customer_id,'store','501229','test_mode',true,
    'product','1451030','variant',pg_temp.variant(p_slug),'status',p_status,'cancelled',p_status='cancelled',
    'renews',coalesce(p_renews, case when p_status in ('active','past_due') then c.baseline_period_end end),'ends',p_ends,
    'created',pg_temp.t(interval '-1 day'),'updated',p_updated) || p_over
  from public.billing_subscription_plan_changes c where c.id=p_change $$;
create function pg_temp.rplan(p_change uuid, s jsonb, p_now timestamptz default null) returns jsonb
language sql as $$
  select to_jsonb(r) from public.plan_billing_plan_change_recovery_v1('test',p_change,s->>'pid',s->>'customer',s->>'store',
    (s->>'test_mode')::boolean,s->>'product',s->>'variant',s->>'status',(s->>'cancelled')::boolean,null,null,null,
    (s->>'renews')::timestamptz,(s->>'ends')::timestamptz,(s->>'created')::timestamptz,(s->>'updated')::timestamptz,
    coalesce(p_now,pg_temp.t(interval '1 hour'))) r $$;
create function pg_temp.rapply(p_change uuid, s jsonb, p_token text, p_now timestamptz default null) returns jsonb
language sql as $$
  select to_jsonb(r) from public.apply_billing_plan_change_recovery_v1('test',p_change,s->>'pid',s->>'customer',s->>'store',
    (s->>'test_mode')::boolean,s->>'product',s->>'variant',s->>'status',(s->>'cancelled')::boolean,null,null,null,
    (s->>'renews')::timestamptz,(s->>'ends')::timestamptz,(s->>'created')::timestamptz,(s->>'updated')::timestamptz,
    p_token,'OPS-C2R','c2 operator recovery contract test','c2-operator',coalesce(p_now,pg_temp.t(interval '1 hour'))) r $$;
create function pg_temp.audits() returns bigint language sql as $$ select count(*) from public.billing_recovery_attempts $$;

-- ================================================================ R0. ACL
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.plan_billing_plan_change_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)',
    'public.apply_billing_plan_change_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,timestamptz)'
  ] loop
    if has_function_privilege('anon',v_fn,'execute') or has_function_privilege('authenticated',v_fn,'execute')
       or not has_function_privilege('service_role',v_fn,'execute')
       or not (select prosecdef from pg_proc where oid=v_fn::regprocedure)
       or (select proconfig from pg_proc where oid=v_fn::regprocedure) is distinct from array['search_path=""'] then
      raise exception 'C2R_ACL_INVALID %', v_fn;
    end if;
  end loop;
  if has_function_privilege('service_role','private.evaluate_billing_plan_change_recovery_v1(public.billing_subscription_plan_changes,public.subscriptions,text,text,text,boolean,text,text,text,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)','execute') then
    raise exception 'C2R_PRIVATE_EXPOSED';
  end if;
  set local role authenticated;
  begin
    perform * from public.apply_billing_plan_change_recovery_v1('test',gen_random_uuid(),'1','2','3',true,'4','5','active',false,null,null,null,null,null,now(),now(),repeat('a',64),'OPS-1','role access attempt','role');
    reset role; raise exception 'C2R_AUTHENTICATED_CAN_APPLY';
  exception when insufficient_privilege then reset role; end;
end $$;

-- ================================================================ R1/R2. inspect is read-only; requested and unknown are not told apart
do $$
declare a record; b record; v_a uuid; v_b uuid; v_before text; v_audits bigint; v_plan jsonb; v_plan_b jsonb;
begin
  select * into a from pg_temp.mk('r1-requested');
  select * into b from pg_temp.mk('r1-unknown');
  v_a := pg_temp.req(a.salon_id,a.owner_id,'pro');           -- process stopped after the intent
  v_b := pg_temp.req(b.salon_id,b.owner_id,'pro');
  perform pg_temp.res(v_b,'ambiguous');                       -- PATCH outcome unknown
  v_before := (select to_jsonb(c)::text from public.billing_subscription_plan_changes c where id=v_a)||pg_temp.sub(a.salon_id);
  v_audits := pg_temp.audits();
  -- provider still shows the previous variant before the renewal: proves neither "sent" nor "not sent"
  v_plan := pg_temp.rplan(v_a,pg_temp.snap(v_a,'starter',pg_temp.t(interval '30 minutes')));
  v_plan_b := pg_temp.rplan(v_b,pg_temp.snap(v_b,'starter',pg_temp.t(interval '30 minutes')));
  perform pg_temp.eq(v_plan->>'error_code','recovery_plan_change_dispatch_unresolved','R1 requested old variant');
  perform pg_temp.eq(v_plan_b->>'error_code','recovery_plan_change_dispatch_unresolved','R2 unknown old variant (same verdict)');
  perform pg_temp.eq((select to_jsonb(c)::text from public.billing_subscription_plan_changes c where id=v_a)||pg_temp.sub(a.salon_id),v_before,'R1 dry-run mutates nothing');
  perform pg_temp.eq(pg_temp.audits()::text,v_audits::text,'R1 dry-run writes no audit');
  -- a valid pre-boundary target read gives the same proposal for both
  perform pg_temp.eq(pg_temp.rplan(v_a,pg_temp.snap(v_a,'pro',pg_temp.t(interval '5 seconds')))->>'proposed_action','record_observed','R2 requested E1');
  perform pg_temp.eq(pg_temp.rplan(v_b,pg_temp.snap(v_b,'pro',pg_temp.t(interval '5 seconds')))->>'proposed_action','record_observed','R2 unknown E1');
  -- unsupported apply is audited but changes nothing
  perform pg_temp.eq(pg_temp.rapply(v_a,pg_temp.snap(v_a,'starter',pg_temp.t(interval '30 minutes')),v_plan->>'review_token')->>'outcome','unsupported','R1 unsupported apply');
  perform pg_temp.eq(pg_temp.st(v_a),'requested','R1 still requested');
  perform pg_temp.eq(pg_temp.audits()::text,(v_audits+1)::text,'R1 unsupported attempt audited');
end $$;

-- ================================================================ R3/R4/R5. record_observed confirms unknown; duplicate and stale apply
do $$
declare s record; v_id uuid; v_snap jsonb; v_plan jsonb; v_out jsonb;
begin
  select * into s from pg_temp.mk('r3-unknown-confirm','starter',2);
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  v_snap := pg_temp.snap(v_id,'pro',pg_temp.t(interval '5 seconds'));
  v_plan := pg_temp.rplan(v_id,v_snap);
  perform pg_temp.eq(v_plan->>'verdict','eligible','R3 eligible');
  v_out := pg_temp.rapply(v_id,v_snap,v_plan->>'review_token');
  perform pg_temp.eq(v_out->>'outcome','recorded','R3 recorded');
  perform pg_temp.eq(pg_temp.st(v_id),'confirmed','R3 confirmed');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'starter:active:true','R3 plan and capped period unchanged');
  perform pg_temp.eq(pg_temp.cap(s.salon_id),'3:plan:-','R3 capacity unchanged');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '3 minutes')),'false:starter:period_expired','R3 still read-only after baseline without E2/E3');
  -- R4 duplicate apply with the same token: no action is eligible any more, so no second effect
  perform pg_temp.eq(pg_temp.rapply(v_id,v_snap,v_plan->>'review_token')->>'outcome','precondition_unmet','R4 duplicate apply has no effect');
  perform pg_temp.eq((select confirmed_source from public.billing_subscription_plan_changes where id=v_id),'operator_provider_read','R4 single confirmation source');
  perform pg_temp.eq(pg_temp.st(v_id),'confirmed','R4 unchanged');
  -- confirmed: the tool proposes nothing new; lifecycle (D) or payment evidence is what is missing
  perform pg_temp.eq(pg_temp.rplan(v_id,v_snap)->>'error_code','recovery_plan_change_lifecycle_evidence_missing','R3 confirmed needs lifecycle evidence');

  -- R5 stale token: a webhook moves the change between dry-run and apply
  select * into s from pg_temp.mk('r5-stale');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  v_snap := pg_temp.snap(v_id,'pro',pg_temp.t(interval '5 seconds'));
  v_plan := pg_temp.rplan(v_id,v_snap);
  perform pg_temp.upd(s.pid,s.customer,'r5-e1','pro','active',pg_temp.t(interval '6 seconds'),pg_temp.b(),null,pg_temp.t(interval '7 seconds'));
  perform pg_temp.eq(pg_temp.rapply(v_id,v_snap,v_plan->>'review_token')->>'outcome','precondition_unmet','R5 webhook confirmed first: no recovery action left');
  perform pg_temp.eq(pg_temp.st(v_id),'confirmed','R5 confirmed by the webhook');

  -- R5b stale token while the action is still eligible: capacity state changed after the review
  select * into s from pg_temp.mk('r5b-stale-capacity');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  v_snap := pg_temp.snap(v_id,'pro',pg_temp.t(interval '5 seconds'));
  v_plan := pg_temp.rplan(v_id,v_snap);
  insert into public.employees(salon_id,full_name) values(s.salon_id,'added after review');
  perform pg_temp.eq(pg_temp.rapply(v_id,v_snap,v_plan->>'review_token')->>'outcome','stale','R5b stale token');
  perform pg_temp.eq(pg_temp.st(v_id),'unknown','R5b nothing applied');
  v_plan := pg_temp.rplan(v_id,v_snap);
  perform pg_temp.eq(pg_temp.rapply(v_id,v_snap,v_plan->>'review_token')->>'outcome','recorded','R5b fresh review applies');
end $$;

-- ================================================================ R6/R7/R8. no completion without proof
do $$
declare s record; v_id uuid; v_base timestamptz; v_plan jsonb;
begin
  -- E1 same-timestamp conflict: never force-completed
  select * into s from pg_temp.mk('r6-same-ts');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  select baseline_provider_updated_at into v_base from public.billing_subscription_plan_changes where id=v_id;
  perform pg_temp.res(v_id,'accepted','pro',v_base);
  perform pg_temp.eq(pg_temp.st(v_id),'manual_review:plan_change_evidence_order_conflict','R6 conflict');
  v_plan := pg_temp.rplan(v_id,pg_temp.snap(v_id,'pro',v_base + interval '1 second'));
  perform pg_temp.eq(v_plan->>'error_code','recovery_plan_change_e1_order_unprovable','R6 unprovable');
  perform pg_temp.eq(pg_temp.rapply(v_id,pg_temp.snap(v_id,'pro',v_base + interval '1 second'),v_plan->>'review_token')->>'outcome','unsupported','R6 apply refused');
  perform pg_temp.eq(pg_temp.st(v_id),'manual_review:plan_change_evidence_order_conflict','R6 still blocked');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '3 minutes')),'false:starter:period_expired','R6 cap stays');

  -- R7 identity / environment mismatch
  select * into s from pg_temp.mk('r7-identity');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.eq(pg_temp.rplan(v_id,pg_temp.snap(v_id,'pro',pg_temp.t(interval '5 seconds'),p_over=>'{"customer":"999"}'))->>'verdict','identity_conflict','R7 customer');
  perform pg_temp.eq(pg_temp.rplan(v_id,pg_temp.snap(v_id,'pro',pg_temp.t(interval '5 seconds'),p_over=>'{"store":"440512"}'))->>'verdict','identity_conflict','R7 store');
  perform pg_temp.eq(pg_temp.rplan(v_id,pg_temp.snap(v_id,'pro',pg_temp.t(interval '5 seconds'),p_over=>'{"pid":"1"}'))->>'verdict','identity_conflict','R7 subscription');
  perform pg_temp.eq(pg_temp.rplan(v_id,pg_temp.snap(v_id,'pro',pg_temp.t(interval '5 seconds'),p_over=>'{"test_mode":false}'))->>'verdict','identity_conflict','R7 test_mode');
  perform pg_temp.eq(pg_temp.rplan(v_id,pg_temp.snap(v_id,'other',pg_temp.t(interval '5 seconds')))->>'error_code','recovery_plan_change_variant_unexpected','R7 unknown variant');
  update private.billing_runtime_config set environment='live';
  perform pg_temp.eq(pg_temp.rplan(v_id,pg_temp.snap(v_id,'pro',pg_temp.t(interval '5 seconds')))->>'verdict','environment_mismatch','R7 environment');
  update private.billing_runtime_config set environment='test';

  -- R8 target read only after the boundary: no pre-boundary proof
  select * into s from pg_temp.mk('r8-after-boundary');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  perform pg_temp.eq(pg_temp.rplan(v_id,pg_temp.snap(v_id,'pro',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month')))->>'error_code',
    'recovery_plan_change_pre_boundary_evidence_missing','R8 no E1 after boundary');
end $$;

-- ================================================================ R9. renewed on the previous plan: payment-gated resolution
do $$
declare s record; o record; v_id uuid; v_snap jsonb; v_plan jsonb; v_inv text;
begin
  select * into s from pg_temp.mk('r9-previous-plan','pro',3);
  select * into o from pg_temp.mk('r9-other');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'starter');     -- pending downgrade
  perform pg_temp.res(v_id,'ambiguous');
  perform pg_temp.eq(pg_temp.cap(s.salon_id),'3:pending_plan_change:starter','R9 reservation while unresolved');
  -- the provider renews on the previous (Pro) variant
  perform pg_temp.upd(s.pid,s.customer,'r9-renew','pro','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes'));
  perform pg_temp.eq(pg_temp.st(v_id),'manual_review:plan_change_renewed_on_previous_plan','R9 conflict');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '3 minutes')),'false:pro:period_expired','R9 capped read-only');
  v_snap := pg_temp.snap(v_id,'pro',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'));
  perform pg_temp.eq(pg_temp.rplan(v_id,v_snap,pg_temp.b(interval '1 hour'))->>'error_code','recovery_plan_change_payment_evidence_missing','R9 no payment evidence');
  -- stale and foreign invoices do not qualify
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'renewal',pg_temp.b(interval '-1 hour'),pg_temp.b(interval '1 hour'));
  perform pg_temp.inv(pg_temp.newinv(),o.pid,o.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '1 hour'));
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'updated',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '1 hour'));
  perform pg_temp.eq(pg_temp.rplan(v_id,v_snap,pg_temp.b(interval '1 hour'))->>'error_code','recovery_plan_change_payment_evidence_missing','R9 stale/foreign invoices ignored');
  -- a fresh read that does not show the previous plan blocks the resolution
  v_inv := pg_temp.newinv();
  perform pg_temp.inv(v_inv,s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '1 hour'));
  perform pg_temp.eq(pg_temp.rplan(v_id,pg_temp.snap(v_id,'starter',pg_temp.b(interval '5 minutes'),pg_temp.b(interval '1 month')),pg_temp.b(interval '1 hour'))->>'error_code',
    'recovery_plan_change_fresh_read_not_previous_plan','R9 fresh read must still show the previous plan');
  v_plan := pg_temp.rplan(v_id,v_snap,pg_temp.b(interval '1 hour'));
  perform pg_temp.eq(v_plan->>'proposed_action','resolve_not_applied','R9 eligible with payment evidence');
  perform pg_temp.eq(pg_temp.rapply(v_id,v_snap,v_plan->>'review_token',pg_temp.b(interval '1 hour'))->>'outcome','resolved_not_applied','R9 resolved');
  perform pg_temp.eq(pg_temp.st(v_id),'not_applied:plan_change_renewed_on_previous_plan','R9 terminal');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '2 hours')),'true:pro:active_period','R9 paid previous-plan period restored');
  perform pg_temp.eq(pg_temp.cap(s.salon_id),'10:plan:-','R9 reservation released only at resolution');
  perform pg_temp.eq(pg_temp.rapply(v_id,v_snap,v_plan->>'review_token',pg_temp.b(interval '1 hour'))->>'outcome','no_change','R9 second apply has no effect');
  -- audit is sanitized
  if exists (select 1 from public.billing_recovery_attempts where recovery_kind='plan_change'
             and (prior_state::text ~ '@|https?://' or coalesce(applied_state::text,'') ~ '@|https?://')) then
    raise exception 'C2R_AUDIT_NOT_SANITIZED';
  end if;
  perform pg_temp.eq((select applied_state->>'action' from public.billing_recovery_attempts where recovery_kind='plan_change' and outcome='resolved_not_applied' limit 1),'resolve_not_applied','R9 audited');
end $$;

-- ================================================================ R10/R11. missed lifecycle via D, then payment evidence; operator vs webhook
do $$
declare s record; v_id uuid; v_token text; v_snap jsonb; v_plan jsonb;
begin
  select * into s from pg_temp.mk('r10-missed-lifecycle');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'accepted','pro',pg_temp.t(interval '5 seconds'));
  v_snap := pg_temp.snap(v_id,'pro',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'));
  perform pg_temp.eq(pg_temp.rplan(v_id,v_snap,pg_temp.b(interval '2 minutes'))->>'error_code','recovery_plan_change_lifecycle_evidence_missing','R10 lifecycle missing');
  -- existing D snapshot recovers the missed renewal; still capped (payment gate)
  select r.review_token into v_token from public.plan_billing_subscription_recovery_v1('test',s.sub_id,s.pid,s.customer,'501229',true,'1451030','2264940','active',false,
    null,null,null,pg_temp.b(interval '1 month'),null,pg_temp.t(interval '-1 day'),pg_temp.b(interval '1 minute'),pg_temp.b(interval '2 minutes')) r;
  perform public.apply_billing_subscription_recovery_v1('test',s.sub_id,s.pid,s.customer,'501229',true,'1451030','2264940','active',false,
    null,null,null,pg_temp.b(interval '1 month'),null,pg_temp.t(interval '-1 day'),pg_temp.b(interval '1 minute'),
    v_token,'OPS-C2R','c2 missed renewal via D','c2-operator',pg_temp.b(interval '2 minutes'));
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'starter:active:true','R10 D snapshot capped');
  perform pg_temp.eq(pg_temp.rplan(v_id,v_snap,pg_temp.b(interval '3 minutes'))->>'error_code','recovery_plan_change_payment_evidence_missing','R10 payment missing');
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '4 minutes'));
  perform pg_temp.eq(pg_temp.st(v_id),'completed','R10 evaluator completes on payment evidence');
  perform pg_temp.eq(pg_temp.rplan(v_id,v_snap,pg_temp.b(interval '5 minutes'))->>'verdict','not_pending','R10 nothing left for the operator');

  -- R11 operator first, then the original webhook E1: one confirmation, no conflict
  select * into s from pg_temp.mk('r11-operator-first');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  v_snap := pg_temp.snap(v_id,'pro',pg_temp.t(interval '5 seconds'));
  v_plan := pg_temp.rplan(v_id,v_snap);
  perform pg_temp.eq(pg_temp.rapply(v_id,v_snap,v_plan->>'review_token')->>'outcome','recorded','R11 operator recorded');
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'r11-e1','pro','active',pg_temp.t(interval '5 seconds'),pg_temp.b(),null,pg_temp.t(interval '2 hours')),'processed','R11 webhook after operator');
  perform pg_temp.eq(pg_temp.st(v_id),'confirmed','R11 still confirmed');
end $$;

-- ================================================================ R12/R13. late target evidence after not_applied; invoice exclusivity
do $$
declare s record; v_id uuid; v_new uuid; v_snap jsonb; v_plan jsonb; v_inv text; v_token text;
begin
  select * into s from pg_temp.mk('r12-late-target');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  perform pg_temp.upd(s.pid,s.customer,'r12-renew','starter','active',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '2 minutes'));
  v_inv := pg_temp.newinv();
  perform pg_temp.inv(v_inv,s.pid,s.customer,'renewal',pg_temp.b(interval '10 seconds'),pg_temp.b(interval '3 minutes'));
  v_snap := pg_temp.snap(v_id,'starter',pg_temp.b(interval '1 minute'),pg_temp.b(interval '1 month'));
  v_plan := pg_temp.rplan(v_id,v_snap,pg_temp.b(interval '4 minutes'));
  perform pg_temp.eq(pg_temp.rapply(v_id,v_snap,v_plan->>'review_token',pg_temp.b(interval '4 minutes'))->>'outcome','resolved_not_applied','R12 resolved');
  -- R13: the resolving invoice is claimed in the shared exclusive column
  perform pg_temp.eq((select renewal_invoice_id from public.billing_subscription_plan_changes where id=v_id),v_inv,'R13 invoice claimed by the resolution');
  perform pg_temp.eq(pg_temp.err(format(
    'insert into public.billing_subscription_plan_changes(subscription_id,salon_id,environment,provider_subscription_id,provider_customer_id,provider_store_id,direction,from_plan_id,target_plan_id,from_provider_product_id,from_provider_variant_id,target_provider_product_id,target_provider_variant_id,baseline_period_end,baseline_provider_updated_at,requested_by_profile_id,requested_at,status,confirmed_provider_updated_at,renewal_invoice_id,completed_period_end) select subscription_id,salon_id,environment,provider_subscription_id,provider_customer_id,provider_store_id,direction,from_plan_id,target_plan_id,from_provider_product_id,from_provider_variant_id,target_provider_product_id,target_provider_variant_id,baseline_period_end,baseline_provider_updated_at,requested_by_profile_id,requested_at,%L,baseline_provider_updated_at,renewal_invoice_id,observed_period_end from public.billing_subscription_plan_changes where id=%L','completed',v_id)),
    'duplicate key value violates unique constraint "billing_plan_changes_invoice_unique_idx"','R13 the same invoice cannot complete another change');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '5 minutes')),'true:starter:active_period','R12 paid previous-plan access');

  -- late (older) target update: no retroactive completion, no change of rights
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'r12-late','pro','active',pg_temp.t(interval '5 seconds'),pg_temp.b(),null,pg_temp.b(interval '6 minutes')),
    'manual_review:processor_updated_plan_change_unsupported','R12 late target is an unsupported plan change');
  -- newer target update: same, nothing applied
  perform pg_temp.eq(pg_temp.upd(s.pid,s.customer,'r12-newer','pro','active',pg_temp.b(interval '2 hours'),pg_temp.b(interval '1 month'),null,pg_temp.b(interval '3 hours')),
    'manual_review:processor_updated_plan_change_unsupported','R12 newer target is an unsupported plan change');
  -- D snapshot with the target: refused, nothing applied
  select r.verdict, r.review_token into v_plan, v_token from (select to_jsonb(x.verdict) as verdict, x.review_token
    from public.plan_billing_subscription_recovery_v1('test',s.sub_id,s.pid,s.customer,'501229',true,'1451030','2264940','active',false,
      null,null,null,pg_temp.b(interval '1 month'),null,pg_temp.t(interval '-1 day'),pg_temp.b(interval '3 hours'),pg_temp.b(interval '4 hours')) x) r;
  perform pg_temp.eq(v_plan#>>'{}','plan_change_unsupported','R12 D snapshot with the target refused');
  perform pg_temp.eq((select outcome from public.apply_billing_subscription_recovery_v1('test',s.sub_id,s.pid,s.customer,'501229',true,'1451030','2264940','active',false,
      null,null,null,pg_temp.b(interval '1 month'),null,pg_temp.t(interval '-1 day'),pg_temp.b(interval '3 hours'),v_token,'OPS-C2R','late target snapshot after resolution','c2-operator',pg_temp.b(interval '4 hours'))),
    'plan_change_unsupported','R12 D apply refused');
  -- an additional invoice changes nothing
  perform pg_temp.inv(pg_temp.newinv(),s.pid,s.customer,'renewal',pg_temp.b(interval '20 seconds'),pg_temp.b(interval '5 hours'));
  perform pg_temp.eq(pg_temp.st(v_id),'not_applied:plan_change_renewed_on_previous_plan','R12 still not_applied');
  perform pg_temp.eq(pg_temp.sub(s.salon_id),'starter:active:false','R12 plan and paid period unchanged');
  perform pg_temp.eq((select (current_period_ends_at=pg_temp.b(interval '1 month'))::text from public.subscriptions where id=s.sub_id),'true','R12 paid previous-plan period kept');

  -- a new allowed change, then evidence of the old one arrives: flagged on the new change, rights kept
  v_new := pg_temp.req(s.salon_id,s.owner_id,'pro',pg_temp.b(interval '6 hours'));
  perform pg_temp.eq(pg_temp.st(v_new),'requested','R12 new change requested');
  perform pg_temp.upd(s.pid,s.customer,'r12-old-evidence','pro','active',pg_temp.t(interval '6 seconds'),pg_temp.b(),null,pg_temp.b(interval '7 hours'));
  perform pg_temp.eq(pg_temp.st(v_new),'manual_review:plan_change_evidence_order_conflict','R12 old evidence flagged on the new change');
  perform pg_temp.eq(pg_temp.st(v_id),'not_applied:plan_change_renewed_on_previous_plan','R12 old change not reopened');
  perform pg_temp.eq(pg_temp.acc(s.salon_id,pg_temp.b(interval '8 hours')),'true:starter:active_period','R12 paid access kept');
end $$;

-- ================================================================ R14. actual audit guarantees
do $$
declare s record; v_id uuid; v_snap jsonb; v_plan jsonb; v_audits bigint; v_err text;
begin
  select * into s from pg_temp.mk('r14-audit');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  v_snap := pg_temp.snap(v_id,'pro',pg_temp.t(interval '5 seconds'));
  v_plan := pg_temp.rplan(v_id,v_snap);
  v_audits := pg_temp.audits();
  -- invalid input: refused before any audit row
  v_err := pg_temp.err(format('select public.apply_billing_plan_change_recovery_v1(%L,%L,%L,%L,%L,true,%L,%L,%L,false,null,null,null,%L,null,%L,%L,%L,%L,%L,%L)',
    'test',v_id,v_snap->>'pid',v_snap->>'customer','501229','1451030','2264940','active',v_snap->>'renews',v_snap->>'created',v_snap->>'updated',v_plan->>'review_token','bad ticket!','short','x y'));
  perform pg_temp.eq(v_err,'BILLING_RECOVERY_TICKET_REQUIRED','R14 invalid input raises');
  -- unknown target and environment mismatch: answered without an audit row
  perform pg_temp.eq(pg_temp.rapply(gen_random_uuid(),v_snap,v_plan->>'review_token')->>'outcome','not_found','R14 not found');
  update private.billing_runtime_config set environment='live';
  perform pg_temp.eq(pg_temp.rapply(v_id,v_snap,v_plan->>'review_token')->>'outcome','environment_mismatch','R14 environment mismatch');
  update private.billing_runtime_config set environment='test';
  perform pg_temp.eq(pg_temp.audits()::text,v_audits::text,'R14 no audit for invalid input, not_found or environment mismatch');
  -- reviewed outcomes are audited, including stale and the repeated apply
  perform pg_temp.eq(pg_temp.rapply(v_id,v_snap,repeat('b',64))->>'outcome','stale','R14 stale');
  perform pg_temp.eq(pg_temp.rapply(v_id,v_snap,v_plan->>'review_token')->>'outcome','recorded','R14 applied');
  perform pg_temp.eq(pg_temp.rapply(v_id,v_snap,v_plan->>'review_token')->>'outcome','precondition_unmet','R14 repeated');
  perform pg_temp.eq(pg_temp.audits()::text,(v_audits+3)::text,'R14 stale, applied and repeated attempts audited');
  -- an exception inside apply rolls back its audit row together with every write
  create function pg_temp.fail_change_update() returns trigger language plpgsql as $f$
  begin raise exception 'C2R_INJECTED_FAILURE'; end $f$;
  select * into s from pg_temp.mk('r14-rollback');
  v_id := pg_temp.req(s.salon_id,s.owner_id,'pro');
  perform pg_temp.res(v_id,'ambiguous');
  v_snap := pg_temp.snap(v_id,'pro',pg_temp.t(interval '5 seconds'));
  v_plan := pg_temp.rplan(v_id,v_snap);
  v_audits := pg_temp.audits();
  create trigger c2r_injected before update on public.billing_subscription_plan_changes for each row execute function pg_temp.fail_change_update();
  perform pg_temp.eq(pg_temp.err(format('select pg_temp.rapply(%L,%L::jsonb,%L)',v_id,v_snap,v_plan->>'review_token')),'C2R_INJECTED_FAILURE','R14 failure surfaced');
  drop trigger c2r_injected on public.billing_subscription_plan_changes;
  perform pg_temp.eq(pg_temp.audits()::text,v_audits::text,'R14 rolled-back attempt leaves no audit row');
  perform pg_temp.eq(pg_temp.st(v_id),'unknown','R14 nothing applied');
end $$;

rollback;
\echo 'Billing C2 operator recovery contract passed.'
