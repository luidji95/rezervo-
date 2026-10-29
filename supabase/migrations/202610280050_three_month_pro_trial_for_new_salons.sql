begin;

-- New salons get a Pro trial of 3 calendar months (was 14 days). Only the duration changes:
-- the trial still starts in the same transaction that creates the salon (AFTER INSERT trigger,
-- started by create_primary_salon_once_v1), with the same time source (transaction now()).
-- Existing subscriptions are not touched: the trigger runs only for new salons and there is no backfill.
--
-- Calendar months are added on the UTC calendar date/time, independent of the session time zone,
-- with PostgreSQL month clamping: 2026-01-31T10:00Z -> 2026-04-30T10:00Z, 2026-11-30T10:00Z ->
-- 2027-02-28T10:00Z, 2027-11-30T10:00Z -> 2028-02-29T10:00Z, 2026-12-15T10:00Z -> 2027-03-15T10:00Z.

create function private.billing_internal_trial_ends_at_v1(p_trial_starts_at timestamptz)
returns timestamptz
language sql
stable
strict
set search_path = ''
as $$
  select ((p_trial_starts_at at time zone 'UTC') + interval '3 months') at time zone 'UTC';
$$;

revoke all on function private.billing_internal_trial_ends_at_v1(timestamptz)
  from public, anon, authenticated, service_role;
comment on function private.billing_internal_trial_ends_at_v1(timestamptz) is
  'Single authority for the internal Pro trial length: start + 3 calendar months on the UTC calendar (month-end clamped).';

create or replace function public.create_trial_subscription_for_new_salon()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pro_plan_id uuid;
  v_trial_starts_at timestamptz := pg_catalog.now();
begin
  select p.id into v_pro_plan_id
  from public.plans p
  where p.slug = 'pro'
  limit 1;

  if v_pro_plan_id is null then
    raise exception 'PRO_PLAN_NOT_CONFIGURED';
  end if;

  insert into public.subscriptions (
    salon_id, plan_id, status, trial_starts_at, trial_ends_at
  ) values (
    new.id, v_pro_plan_id, 'trialing', v_trial_starts_at,
    private.billing_internal_trial_ends_at_v1(v_trial_starts_at)
  )
  on conflict (salon_id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_trial_subscription_for_new_salon()
  from public, anon, authenticated;
grant execute on function public.create_trial_subscription_for_new_salon()
  to service_role;

comment on function public.create_trial_subscription_for_new_salon() is
  'Creates the provider-free Pro trial for a new salon: 3 calendar months from the salon-creation transaction time (private.billing_internal_trial_ends_at_v1). Never updates an existing subscription.';

commit;
