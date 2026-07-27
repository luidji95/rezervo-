-- Read-only employee hardening pre/post audit. Contains no employee PII.
with current_capacity as (
  select s.id as salon_id,
    count(e.id) filter (where e.is_active) as active_count,
    coalesce(op.max_employees, sp.max_employees) as max_employees,
    case
      when op.id is not null then true
      when sub.status = 'trialing' and sub.trial_ends_at > now() then true
      when sub.status = 'active' and (sub.current_period_ends_at > now() or sub.current_period_ends_at is null) then true
      when sub.status = 'cancelled' and sub.current_period_ends_at > now() then true
      else false
    end as has_full_access
  from public.salons s
  left join public.employees e on e.salon_id = s.id
  left join public.billing_access_overrides o on o.salon_id = s.id
    and o.enabled and o.starts_at <= now() and (o.ends_at is null or o.ends_at > now())
  left join public.plans op on op.id = o.plan_id
  left join public.subscriptions sub on sub.salon_id = s.id
  left join public.plans sp on sp.id = sub.plan_id
  group by s.id, op.id, op.max_employees, sub.status, sub.trial_ends_at,
    sub.current_period_ends_at, sp.max_employees
)
select jsonb_build_object(
  'employees', (select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where e.is_active),
    'inactive', count(*) filter (where not e.is_active),
    'linked_profiles', count(*) filter (where e.profile_id is not null)
  ) from public.employees e),
  'relations', jsonb_build_object(
    'employee_services', (select count(*) from public.employee_services),
    'salon_members', (select count(*) from public.salon_members),
    'team_invitations', (select count(*) from public.team_invitations)
  ),
  'capacity', (select jsonb_build_object(
    'salons_over_limit', count(*) filter (where c.max_employees is not null and c.active_count > c.max_employees),
    'salons_at_limit', count(*) filter (where c.max_employees is not null and c.active_count = c.max_employees),
    'salons_without_full_access', count(*) filter (where not c.has_full_access),
    'salons_without_capacity_contract', count(*) filter (where c.max_employees is null)
  ) from current_capacity c),
  'employee_policies', (select coalesce(jsonb_agg(jsonb_build_object(
    'name', p.policyname, 'command', p.cmd, 'roles', p.roles,
    'using', p.qual, 'with_check', p.with_check
  ) order by p.policyname), '[]'::jsonb) from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'employees'),
  'employee_grants', (select coalesce(jsonb_agg(jsonb_build_object(
      'grantee', x.grantee, 'privileges', x.privileges
    ) order by x.grantee), '[]'::jsonb) from (
      select g.grantee, array_agg(g.privilege_type order by g.privilege_type) privileges
      from information_schema.role_table_grants g
      where g.table_schema = 'public' and g.table_name = 'employees'
        and g.grantee in ('anon','authenticated','service_role')
      group by g.grantee
    ) x),
  'browser_write_column_grant_count', (select count(*)
    from information_schema.column_privileges g
    where g.table_schema = 'public' and g.table_name = 'employees'
      and g.grantee in ('anon','authenticated')
      and g.privilege_type in ('INSERT','UPDATE','DELETE'))
);
