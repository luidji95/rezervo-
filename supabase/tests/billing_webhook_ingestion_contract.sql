begin;

do $$
declare
  v_hash text := repeat('a', 64);
  v_semantic text := repeat('b', 64);
  v_plans_before text;
  v_subscriptions_before text;
  v_sessions_before text;
begin
  select md5(coalesce(string_agg(row_to_json(p)::text, '|' order by p.id), ''))
    into v_plans_before from public.plans p;
  select md5(coalesce(string_agg(row_to_json(s)::text, '|' order by s.id), ''))
    into v_subscriptions_before from public.subscriptions s;
  select md5(coalesce(string_agg(row_to_json(c)::text, '|' order by c.id), ''))
    into v_sessions_before from public.billing_checkout_sessions c;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'billing_webhook_events'
  ) then
    raise exception 'billing_webhook_events table is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'billing_webhook_events'
      and column_name = 'semantic_fingerprint'
      and is_nullable = 'YES'
  ) then
    raise exception 'nullable semantic fingerprint column is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_webhook_events_semantic_fingerprint_check'
  ) then
    raise exception 'semantic fingerprint check constraint is missing';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'billing_webhook_events'
      and indexname = 'billing_webhook_events_semantic_unique'
      and indexdef ilike '%where (semantic_fingerprint is not null)%'
  ) then
    raise exception 'partial semantic fingerprint unique index is missing';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_webhook_events_delivery_unique'
  ) then
    raise exception 'webhook delivery unique constraint is missing';
  end if;

  if not exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'billing_webhook_events_status_received_idx'
      and c.relkind = 'i'
  ) then
    raise exception 'webhook status index is missing';
  end if;

  if not (
    select c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'billing_webhook_events'
  ) then
    raise exception 'RLS is not enabled';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'billing_webhook_events'
  ) then
    raise exception 'browser policies must not exist';
  end if;

  if has_table_privilege('anon', 'public.billing_webhook_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.billing_webhook_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.billing_webhook_events', 'SELECT') then
    raise exception 'browser roles must not access webhook events';
  end if;

  if not has_table_privilege('service_role', 'public.billing_webhook_events', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'service_role webhook privileges are missing';
  end if;

  insert into public.billing_webhook_events (
    provider, environment, event_name, provider_object_type,
    provider_object_id, payload_hash, processing_status
  ) values (
    'lemonsqueezy', 'test', 'subscription_created', 'subscriptions',
    'test-object', v_hash, 'received'
  );

  if not exists (
    select 1 from public.billing_webhook_events
    where payload_hash = v_hash and semantic_fingerprint is null
  ) then
    raise exception 'pre-019 compatible null semantic fingerprint was rejected';
  end if;

  begin
    insert into public.billing_webhook_events (
      provider, environment, event_name, provider_object_type,
      provider_object_id, payload_hash, processing_status
    ) values (
      'lemonsqueezy', 'test', 'subscription_created', 'subscriptions',
      'test-object', v_hash, 'received'
    );
    raise exception 'duplicate delivery was accepted';
  exception when unique_violation then
    null;
  end;

  insert into public.billing_webhook_events (
    provider, environment, event_name, provider_object_type,
    provider_object_id, payload_hash, semantic_fingerprint, processing_status
  ) values (
    'lemonsqueezy', 'test', 'subscription_updated', 'subscriptions',
    'semantic-object', repeat('c', 64), v_semantic, 'received'
  );

  begin
    insert into public.billing_webhook_events (
      provider, environment, event_name, provider_object_type,
      provider_object_id, payload_hash, semantic_fingerprint, processing_status
    ) values (
      'lemonsqueezy', 'test', 'subscription_updated', 'subscriptions',
      'semantic-object', repeat('d', 64), v_semantic, 'received'
    );
    raise exception 'semantic duplicate was accepted';
  exception when unique_violation then
    null;
  end;

  if v_plans_before <> (
    select md5(coalesce(string_agg(row_to_json(p)::text, '|' order by p.id), ''))
    from public.plans p
  ) or v_subscriptions_before <> (
    select md5(coalesce(string_agg(row_to_json(s)::text, '|' order by s.id), ''))
    from public.subscriptions s
  ) or v_sessions_before <> (
    select md5(coalesce(string_agg(row_to_json(c)::text, '|' order by c.id), ''))
    from public.billing_checkout_sessions c
  ) then
    raise exception 'webhook ledger insert changed protected billing state';
  end if;
end;
$$;

rollback;
