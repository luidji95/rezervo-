-- Central entitlement system, phase 1. Existing prices and subscriptions are preserved.

update public.plans
set max_employees = 3,
    max_monthly_bookings = null,
    max_ai_messages = 0,
    analytics_enabled = false,
    ai_receptionist_enabled = false,
    whatsapp_enabled = false,
    instagram_enabled = false,
    marketing_enabled = false,
    is_active = true
where slug = 'starter';

update public.plans
set max_employees = 10,
    max_monthly_bookings = null,
    max_ai_messages = 0,
    analytics_enabled = true,
    ai_receptionist_enabled = false,
    whatsapp_enabled = false,
    instagram_enabled = false,
    marketing_enabled = false,
    is_active = true
where slug = 'pro';

update public.plans
set max_employees = 25,
    max_monthly_bookings = null,
    max_ai_messages = 5000,
    analytics_enabled = true,
    ai_receptionist_enabled = true,
    whatsapp_enabled = true,
    instagram_enabled = true,
    marketing_enabled = true,
    is_active = false
where slug = 'premium';

do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'subscriptions'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy if exists %I on public.subscriptions', policy_row.policyname);
  end loop;
end
$$;

alter table public.subscriptions enable row level security;

drop policy if exists subscriptions_owner_manager_read on public.subscriptions;
create policy subscriptions_owner_manager_read
on public.subscriptions
for select
to authenticated
using (
  exists (
    select 1
    from public.salons s
    where s.id = subscriptions.salon_id
      and s.owner_id = auth.uid()
  )
  or exists (
    select 1
    from public.salon_members sm
    where sm.salon_id = subscriptions.salon_id
      and sm.profile_id = auth.uid()
      and sm.status = 'active'
      and sm.role in ('owner', 'manager')
  )
);

insert into public.subscriptions (salon_id, plan_id, status)
select s.id, p.id, 'active'
from public.salons s
cross join lateral (
  select id from public.plans where slug = 'pro' limit 1
) p
where not exists (
  select 1 from public.subscriptions sub where sub.salon_id = s.id
);

create or replace function public.create_trial_subscription_for_new_salon()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pro_plan_id uuid;
begin
  select id into pro_plan_id
  from public.plans
  where slug = 'pro'
  limit 1;

  if pro_plan_id is null then
    raise exception 'PRO_PLAN_NOT_CONFIGURED';
  end if;

  insert into public.subscriptions (
    salon_id,
    plan_id,
    status,
    trial_starts_at,
    trial_ends_at
  ) values (
    new.id,
    pro_plan_id,
    'trialing',
    now(),
    now() + interval '14 days'
  )
  on conflict (salon_id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_trial_subscription_for_new_salon() from public, anon, authenticated;

drop trigger if exists create_trial_subscription_after_salon_insert on public.salons;
create trigger create_trial_subscription_after_salon_insert
after insert on public.salons
for each row
execute function public.create_trial_subscription_for_new_salon();

create or replace function public.create_employee_with_entitlement(
  p_salon_id uuid,
  p_full_name text,
  p_display_name text default null,
  p_position text default null,
  p_phone text default null,
  p_email text default null,
  p_bio text default null
)
returns public.employees
language plpgsql
security definer
set search_path = ''
as $$
declare
  employee_limit integer;
  active_employee_count integer;
  created_employee public.employees;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;

  if not exists (
    select 1 from public.salons s
    where s.id = p_salon_id and s.owner_id = auth.uid()
  ) and not exists (
    select 1 from public.salon_members sm
    where sm.salon_id = p_salon_id
      and sm.profile_id = auth.uid()
      and sm.status = 'active'
      and sm.role in ('owner', 'manager')
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_salon_id::text, 0));

  select p.max_employees into employee_limit
  from public.subscriptions sub
  join public.plans p on p.id = sub.plan_id
  where sub.salon_id = p_salon_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ENTITLEMENTS_NOT_CONFIGURED';
  end if;

  if employee_limit is not null then
    select count(*) into active_employee_count
    from public.employees e
    where e.salon_id = p_salon_id and e.is_active = true;

    if active_employee_count >= employee_limit then
      raise exception using errcode = 'P0001', message = 'EMPLOYEE_LIMIT_REACHED';
    end if;
  end if;

  insert into public.employees (
    salon_id, full_name, display_name, position, phone, email, bio
  ) values (
    p_salon_id, p_full_name, p_display_name, p_position, p_phone, p_email, p_bio
  )
  returning * into created_employee;

  return created_employee;
end;
$$;

revoke all on function public.create_employee_with_entitlement(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_employee_with_entitlement(uuid, text, text, text, text, text, text) to authenticated;
