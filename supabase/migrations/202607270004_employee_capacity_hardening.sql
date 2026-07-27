begin;

create or replace function public.resolve_employee_capacity_v1(
  p_salon_id uuid,
  p_now timestamptz default now()
)
returns table (
  has_full_access boolean,
  access_reason text,
  effective_plan_id uuid,
  effective_plan_slug text,
  max_employees integer,
  access_source text,
  is_legacy_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_override record;
  v_subscription record;
begin
  select o.plan_id, p.slug, p.max_employees
  into v_override
  from public.billing_access_overrides o
  join public.plans p on p.id = o.plan_id
  where o.salon_id = p_salon_id
    and o.enabled = true
    and o.starts_at <= p_now
    and (o.ends_at is null or o.ends_at > p_now)
  limit 1;

  if found then
    return query select true, 'billing_override'::text, v_override.plan_id,
      v_override.slug::text, v_override.max_employees, 'billing_override'::text, false;
    return;
  end if;

  select s.status, s.trial_ends_at, s.current_period_ends_at,
    p.id as plan_id, p.slug, p.max_employees
  into v_subscription
  from public.subscriptions s
  left join public.plans p on p.id = s.plan_id
  where s.salon_id = p_salon_id
  limit 1;

  if not found then
    return query select false, 'subscription_missing'::text, null::uuid,
      null::text, null::integer, 'subscription'::text, false;
    return;
  end if;

  if v_subscription.plan_id is null then
    return query select false, 'plan_missing'::text, null::uuid,
      null::text, null::integer, 'subscription'::text, false;
    return;
  end if;

  if v_subscription.status = 'trialing'::public.subscription_status then
    return query select
      v_subscription.trial_ends_at is not null and v_subscription.trial_ends_at > p_now,
      case when v_subscription.trial_ends_at is null then 'invalid_trial_period'
           when v_subscription.trial_ends_at > p_now then 'active_trial'
           else 'trial_expired' end,
      v_subscription.plan_id, v_subscription.slug::text,
      v_subscription.max_employees, 'subscription'::text, false;
  elsif v_subscription.status = 'active'::public.subscription_status then
    return query select
      v_subscription.current_period_ends_at is null or v_subscription.current_period_ends_at > p_now,
      case when v_subscription.current_period_ends_at is null then 'legacy_active_no_period'
           when v_subscription.current_period_ends_at > p_now then 'active_period'
           else 'period_expired' end,
      v_subscription.plan_id, v_subscription.slug::text,
      v_subscription.max_employees, 'subscription'::text,
      v_subscription.current_period_ends_at is null;
  elsif v_subscription.status = 'cancelled'::public.subscription_status then
    return query select
      v_subscription.current_period_ends_at is not null and v_subscription.current_period_ends_at > p_now,
      case when v_subscription.current_period_ends_at is not null
                  and v_subscription.current_period_ends_at > p_now
           then 'cancelled_until_period_end' else 'cancelled' end,
      v_subscription.plan_id, v_subscription.slug::text,
      v_subscription.max_employees, 'subscription'::text, false;
  else
    return query select false, v_subscription.status::text,
      v_subscription.plan_id, v_subscription.slug::text,
      v_subscription.max_employees, 'subscription'::text, false;
  end if;
end;
$$;

revoke all on function public.resolve_employee_capacity_v1(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_employee_capacity_v1(uuid, timestamptz)
  to service_role;

create or replace function public.enforce_employee_capacity_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity record;
  v_active_count integer;
begin
  if new.is_active = true and (
    tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.is_active = false)
  ) then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('rezervo:employee-capacity:' || new.salon_id::text, 0)
    );

    select * into v_capacity
    from public.resolve_employee_capacity_v1(new.salon_id, pg_catalog.now());

    if v_capacity.effective_plan_id is null then
      raise exception using errcode = 'P0001', message = 'EMPLOYEE_ENTITLEMENT_NOT_CONFIGURED';
    end if;
    if not v_capacity.has_full_access then
      raise exception using errcode = 'P0001', message = 'EMPLOYEE_ACCESS_REQUIRED';
    end if;

    if v_capacity.max_employees is not null then
      select count(*) into v_active_count
      from public.employees e
      where e.salon_id = new.salon_id and e.is_active = true;
      if v_active_count >= v_capacity.max_employees then
        raise exception using errcode = 'P0001', message = 'EMPLOYEE_LIMIT_REACHED';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_employee_capacity_v1()
  from public, anon, authenticated;

drop trigger if exists enforce_employee_capacity_v1 on public.employees;
create trigger enforce_employee_capacity_v1
before insert or update of is_active on public.employees
for each row execute function public.enforce_employee_capacity_v1();

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
  v_employee public.employees;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='UNAUTHORIZED'; end if;
  if not public.is_salon_owner_or_manager(p_salon_id) then
    raise exception using errcode='42501', message='FORBIDDEN';
  end if;
  if p_full_name is null or length(btrim(p_full_name)) < 1 or length(btrim(p_full_name)) > 200
     or (p_email is not null and length(btrim(p_email)) > 320)
     or (p_bio is not null and length(p_bio) > 5000) then
    raise exception using errcode='22023', message='INVALID_EMPLOYEE';
  end if;

  insert into public.employees (
    salon_id, full_name, display_name, position, phone, email, bio
  ) values (
    p_salon_id, btrim(p_full_name), nullif(btrim(p_display_name), ''),
    nullif(btrim(p_position), ''), nullif(btrim(p_phone), ''),
    nullif(btrim(p_email), ''), nullif(btrim(p_bio), '')
  ) returning * into v_employee;
  return v_employee;
end;
$$;

create or replace function public.update_employee_details_v1(
  p_employee_id uuid, p_full_name text, p_display_name text,
  p_position text, p_phone text, p_email text, p_bio text,
  p_is_bookable boolean, p_is_public boolean
)
returns public.employees
language plpgsql security definer set search_path = ''
as $$
declare v_employee public.employees;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='UNAUTHORIZED'; end if;
  select e.* into v_employee from public.employees e where e.id=p_employee_id;
  if not found then raise exception using errcode='P0002', message='EMPLOYEE_NOT_FOUND'; end if;
  if not public.is_salon_owner_or_manager(v_employee.salon_id) then raise exception using errcode='42501', message='FORBIDDEN'; end if;
  if p_full_name is null or length(btrim(p_full_name)) < 1 or length(btrim(p_full_name)) > 200
     or (p_email is not null and length(btrim(p_email)) > 320)
     or (p_bio is not null and length(p_bio) > 5000) then
    raise exception using errcode='22023', message='INVALID_EMPLOYEE';
  end if;
  update public.employees e set
    full_name=btrim(p_full_name), display_name=nullif(btrim(p_display_name),''),
    position=nullif(btrim(p_position),''), phone=nullif(btrim(p_phone),''),
    email=nullif(btrim(p_email),''), bio=nullif(btrim(p_bio),''),
    is_bookable=coalesce(p_is_bookable, e.is_bookable),
    is_public=coalesce(p_is_public, e.is_public)
  where e.id=p_employee_id returning e.* into v_employee;
  return v_employee;
end;
$$;

create or replace function public.set_employee_active_state(
  p_employee_id uuid, p_is_active boolean
)
returns public.employees
language plpgsql security definer set search_path = ''
as $$
declare v_employee public.employees;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='UNAUTHORIZED'; end if;
  select e.* into v_employee from public.employees e where e.id=p_employee_id for update;
  if not found then raise exception using errcode='P0002', message='EMPLOYEE_NOT_FOUND'; end if;
  if not public.is_salon_owner_or_manager(v_employee.salon_id) then raise exception using errcode='42501', message='FORBIDDEN'; end if;
  if v_employee.is_active = p_is_active then return v_employee; end if;
  update public.employees e set
    is_active=p_is_active,
    is_bookable=case when p_is_active then e.is_bookable else false end,
    is_public=case when p_is_active then e.is_public else false end
  where e.id=p_employee_id returning e.* into v_employee;
  return v_employee;
end;
$$;

create or replace function public.delete_employee_safely_v1(p_employee_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_employee public.employees; v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception using errcode='42501', message='UNAUTHORIZED'; end if;
  select e.* into v_employee from public.employees e where e.id=p_employee_id for update;
  if not found then raise exception using errcode='P0002', message='EMPLOYEE_NOT_FOUND'; end if;
  if not public.is_salon_owner_or_manager(v_employee.salon_id) then raise exception using errcode='42501', message='FORBIDDEN'; end if;
  if exists (select 1 from public.appointments a where a.employee_id=p_employee_id
      and a.status in ('pending','confirmed') and a.start_time >= v_now) then
    raise exception using errcode='P0001', message='EMPLOYEE_HAS_FUTURE_APPOINTMENTS';
  end if;
  if exists (select 1 from public.appointments a where a.employee_id=p_employee_id) then
    update public.employees e set is_active=false,is_bookable=false,is_public=false where e.id=p_employee_id;
    return 'soft';
  end if;
  delete from public.employees e where e.id=p_employee_id;
  return 'hard';
end;
$$;

create or replace function public.link_current_owner_employee_v1(p_employee_id uuid)
returns public.employees
language plpgsql security definer set search_path = ''
as $$
declare v_employee public.employees;
begin
  if auth.uid() is null then raise exception using errcode='42501', message='UNAUTHORIZED'; end if;
  select e.* into v_employee from public.employees e join public.salons s on s.id=e.salon_id
  where e.id=p_employee_id and s.owner_id=auth.uid() for update of e;
  if not found then raise exception using errcode='42501', message='FORBIDDEN'; end if;
  if v_employee.profile_id is not null and v_employee.profile_id <> auth.uid() then
    raise exception using errcode='P0001', message='EMPLOYEE_ALREADY_LINKED';
  end if;
  if exists (select 1 from public.employees e where e.salon_id=v_employee.salon_id
      and e.profile_id=auth.uid() and e.id<>p_employee_id) then
    raise exception using errcode='P0001', message='PROFILE_ALREADY_LINKED';
  end if;
  update public.employees e set profile_id=auth.uid()
  where e.id=p_employee_id and e.profile_id is null returning e.* into v_employee;
  if not found then select e.* into v_employee from public.employees e where e.id=p_employee_id; end if;
  return v_employee;
exception when unique_violation then
  raise exception using errcode='P0001', message='PROFILE_ALREADY_LINKED';
end;
$$;

revoke all on function public.create_employee_with_entitlement(uuid,text,text,text,text,text,text) from public,anon;
revoke all on function public.update_employee_details_v1(uuid,text,text,text,text,text,text,boolean,boolean) from public,anon;
revoke all on function public.set_employee_active_state(uuid,boolean) from public,anon;
revoke all on function public.delete_employee_safely_v1(uuid) from public,anon;
revoke all on function public.link_current_owner_employee_v1(uuid) from public,anon;
grant execute on function public.create_employee_with_entitlement(uuid,text,text,text,text,text,text) to authenticated,service_role;
grant execute on function public.update_employee_details_v1(uuid,text,text,text,text,text,text,boolean,boolean) to authenticated,service_role;
grant execute on function public.set_employee_active_state(uuid,boolean) to authenticated,service_role;
grant execute on function public.delete_employee_safely_v1(uuid) to authenticated,service_role;
grant execute on function public.link_current_owner_employee_v1(uuid) to authenticated,service_role;

drop policy if exists employees_manage_owner_or_manager on public.employees;
create policy employees_update_owner_or_manager on public.employees
for update to authenticated
using (public.is_salon_owner_or_manager(employees.salon_id))
with check (public.is_salon_owner_or_manager(employees.salon_id));

revoke all on table public.employees from anon, authenticated;
grant select on table public.employees to anon, authenticated;
grant all on table public.employees to service_role;

comment on function public.resolve_employee_capacity_v1(uuid,timestamptz) is
  'Read-only employee capacity contract: active override first, then subscription lifecycle.';
comment on function public.enforce_employee_capacity_v1() is
  'Final employee insert/reactivation authority with salon-scoped advisory locking.';

commit;
