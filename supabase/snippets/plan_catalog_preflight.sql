-- Read-only production pre/post migration audit. No tenant identifiers.
select jsonb_build_object(
  'plans', (select jsonb_agg(jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name,
    'monthly_price', p.monthly_price, 'yearly_price', p.yearly_price,
    'currency', p.currency, 'max_employees', p.max_employees,
    'analytics_enabled', p.analytics_enabled,
    'sms_reminders_enabled', p.sms_reminders_enabled,
    'max_monthly_reminders', p.max_monthly_reminders,
    'is_active', p.is_active
  ) order by p.slug) from public.plans p where p.slug in ('starter','pro','premium')),
  'provider_combinations', (select coalesce(jsonb_agg(to_jsonb(x) order by x.billing_provider, x.has_customer_id, x.has_subscription_id), '[]'::jsonb) from (
    select s.billing_provider,
      s.provider_customer_id is not null as has_customer_id,
      s.provider_subscription_id is not null as has_subscription_id,
      count(*) as row_count
    from public.subscriptions s
    group by 1,2,3
  ) x),
  'subscription_count', (select count(*) from public.subscriptions),
  'status_distribution', (select jsonb_object_agg(x.status, x.row_count) from (
    select s.status::text status, count(*) row_count from public.subscriptions s group by s.status
  ) x),
  'plan_distribution', (select jsonb_object_agg(x.slug, x.row_count) from (
    select p.slug, count(*) row_count from public.subscriptions s join public.plans p on p.id=s.plan_id group by p.slug
  ) x),
  'override_count', (select count(*) from public.billing_access_overrides),
  'grant_counts', (select jsonb_object_agg(x.scope, x.row_count) from (
    select concat(g.object_schema, ':', g.grantee) scope, count(*) row_count
    from (
      select table_schema object_schema, grantee
      from information_schema.role_table_grants
      where table_schema in ('public','private')
      union all
      select routine_schema, grantee
      from information_schema.role_routine_grants
      where routine_schema in ('public','private')
    ) g
    group by g.object_schema, g.grantee
  ) x),
  'subscription_policies', (select jsonb_agg(jsonb_build_object(
    'name', pol.policyname, 'command', pol.cmd, 'roles', pol.roles,
    'using', pol.qual, 'with_check', pol.with_check
  ) order by pol.policyname) from pg_policies pol
    where pol.schemaname='public' and pol.tablename='subscriptions')
);
