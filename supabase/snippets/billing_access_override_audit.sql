-- Read-only aggregate audit. Returns no tenant identifiers or personal data.
select
  (select count(*) from public.subscriptions s
   where s.status = 'active' and s.current_period_ends_at is null) as legacy_active_without_period,
  (select count(*) from public.billing_access_overrides) as total_billing_overrides,
  (select count(*) from public.billing_access_overrides o
   where o.enabled
     and o.starts_at <= now()
     and (o.ends_at is null or o.ends_at > now())) as active_billing_overrides;
