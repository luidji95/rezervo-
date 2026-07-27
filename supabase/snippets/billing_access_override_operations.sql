-- SERVER-ONLY OPERATOR RUNBOOK. Execute as postgres/service-role tooling.
-- Never expose this flow as a browser query. Always use an explicit salon UUID.

-- Read one override (no tenant/profile data):
-- select salon_id, override_type, enabled, starts_at, ends_at, plan_id, created_at, updated_at
-- from public.billing_access_overrides
-- where salon_id = '<SALON_UUID>'::uuid;

-- Create/update. Safe default is ROLLBACK. Review the RETURNING output, then
-- explicitly replace ROLLBACK with COMMIT in a separate approved execution.
begin;
insert into public.billing_access_overrides (
  salon_id, plan_id, override_type, reason, enabled, starts_at, ends_at
)
select
  '<SALON_UUID>'::uuid,
  p.id,
  '<internal|pilot|complimentary|support>',
  '<REQUIRED_INTERNAL_REASON>',
  true,
  now(),
  null::timestamptz
from public.plans p
where p.slug = '<starter|pro|premium>'
on conflict (salon_id) do update set
  plan_id = excluded.plan_id,
  override_type = excluded.override_type,
  reason = excluded.reason,
  enabled = excluded.enabled,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  updated_at = now()
returning salon_id, override_type, enabled, starts_at, ends_at, plan_id;
rollback;

-- Disable. Also defaults to ROLLBACK until explicitly approved.
begin;
update public.billing_access_overrides
set enabled = false, updated_at = now()
where salon_id = '<SALON_UUID>'::uuid
returning salon_id, override_type, enabled, starts_at, ends_at, plan_id;
rollback;
