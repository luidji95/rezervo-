begin;

create temporary table b11a_subscription_before as select * from public.subscriptions;
create temporary table b11a_checkout_before as select * from public.billing_checkout_sessions;

do $$
declare
  v record;
  v_event uuid;
  v_before_events bigint;
begin
  select * into v from public.ingest_billing_subscription_invoice_evidence_v1(
    'lemonsqueezy','test','subscription_payment_success','subscription-invoices','81001',
    repeat('a',64),repeat('b',64),true,'81001','2383060','99110','440512',
    'renewal','paid','2026-08-28T10:59:00Z','2026-08-28T11:00:00Z','2026-08-28T11:01:00Z'
  );
  assert v.outcome='invoice_evidence_recorded' and v.stored_status='processed',
    format('first outcome=%s status=%s',v.outcome,v.stored_status);
  v_event:=v.event_id;
  assert (select count(*)=1 from public.billing_webhook_subscription_invoice_facts where webhook_event_id=v_event), 'first facts missing';
  assert (select processing_status='processed' and last_processing_outcome='invoice_evidence_recorded'
          from public.billing_webhook_events where id=v_event), 'event terminal outcome mismatch';

  select * into v from public.ingest_billing_subscription_invoice_evidence_v1(
    'lemonsqueezy','test','subscription_payment_success','subscription-invoices','81001',
    repeat('a',64),repeat('c',64),true,'81001','2383060','99110','440512',
    'renewal','paid','2026-08-28T10:59:00Z','2026-08-28T11:00:00Z','2026-08-28T11:02:00Z'
  );
  assert v.outcome='invoice_evidence_already_recorded', format('raw duplicate=%s',v.outcome);

  select * into v from public.ingest_billing_subscription_invoice_evidence_v1(
    'lemonsqueezy','test','subscription_payment_success','subscription-invoices','81001',
    repeat('d',64),repeat('e',64),true,'81001','2383060','99110','440512',
    'renewal','paid','2026-08-28T10:59:00Z','2026-08-28T11:00:00Z','2026-08-28T11:03:00Z'
  );
  assert v.outcome='invoice_evidence_already_recorded', format('business duplicate=%s',v.outcome);
  assert (select count(*)=1 from public.billing_webhook_subscription_invoice_facts
          where provider='lemonsqueezy' and environment='test' and provider_invoice_id='81001');

  select * into v from public.ingest_billing_subscription_invoice_evidence_v1(
    'lemonsqueezy','test','subscription_payment_success','subscription-invoices','81001',
    repeat('f',64),repeat('1',64),true,'81001','2383060','99110','440512',
    'updated','paid','2026-08-28T10:59:00Z','2026-08-28T11:00:00Z','2026-08-28T11:04:00Z'
  );
  assert v.outcome='invoice_evidence_conflict' and v.stored_status='manual_review';

  select * into v from public.ingest_billing_subscription_invoice_evidence_v1(
    'lemonsqueezy','live','subscription_payment_success','subscription-invoices','81001',
    repeat('2',64),repeat('3',64),false,'81001','2383060','99110','440512',
    'initial','paid','2026-08-28T10:59:00Z','2026-08-28T11:00:00Z','2026-08-28T11:05:00Z'
  );
  assert v.outcome='invoice_evidence_recorded';
  assert (select count(*)=2 from public.billing_webhook_subscription_invoice_facts where provider_invoice_id='81001');

  select count(*) into v_before_events from public.billing_webhook_events;
  begin
    perform * from public.ingest_billing_subscription_invoice_evidence_v1(
      'lemonsqueezy','test','subscription_payment_success','subscription-invoices','82001',
      repeat('4',64),repeat('5',64),true,'82001','2383060','99110','440512',
      'renewal','paid','2026-09-01T12:00:00Z','2026-09-01T11:00:00Z','2026-09-01T12:01:00Z'
    );
    assert false, 'invalid timestamp contract unexpectedly succeeded';
  exception when check_violation then null;
  end;
  assert (select count(*)=v_before_events from public.billing_webhook_events);
  assert not exists(select 1 from public.billing_webhook_subscription_invoice_facts where provider_invoice_id='82001');
end $$;

do $$
begin
  assert not pg_catalog.has_table_privilege('anon','public.billing_webhook_subscription_invoice_facts','select');
  assert not pg_catalog.has_table_privilege('authenticated','public.billing_webhook_subscription_invoice_facts','select');
  assert not pg_catalog.has_table_privilege('service_role','public.billing_webhook_subscription_invoice_facts','select');
  assert pg_catalog.has_function_privilege(
    'service_role',
    'public.ingest_billing_subscription_invoice_evidence_v1(text,text,text,text,text,text,text,boolean,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz)',
    'execute'
  );
  assert (select relrowsecurity from pg_catalog.pg_class where oid='public.billing_webhook_subscription_invoice_facts'::regclass);
  assert (select proowner='postgres'::regrole and proconfig=array['search_path=""']
          from pg_catalog.pg_proc where oid='public.ingest_billing_subscription_invoice_evidence_v1(text,text,text,text,text,text,text,boolean,text,text,text,text,text,text,timestamptz,timestamptz,timestamptz)'::regprocedure);
end $$;

do $$
begin
  assert not exists(
    (select * from public.subscriptions except select * from b11a_subscription_before)
    union all
    (select * from b11a_subscription_before except select * from public.subscriptions)
  );
  assert not exists(
    (select * from public.billing_checkout_sessions except select * from b11a_checkout_before)
    union all
    (select * from b11a_checkout_before except select * from public.billing_checkout_sessions)
  );
end $$;

rollback;
