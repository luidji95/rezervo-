-- Execute only against a disposable/test database after baseline, seed and
-- post-cutover migrations. Fixtures are transactional and rolled back.

begin;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('81000000-0000-4000-8000-000000000001', 'override-owner-a@example.invalid', '{}'::jsonb, '{}'::jsonb),
  ('81000000-0000-4000-8000-000000000002', 'override-owner-b@example.invalid', '{}'::jsonb, '{}'::jsonb);

insert into public.salons (id, owner_id, name, slug)
values
  ('82000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'Override RLS Salon A', 'override-rls-salon-a'),
  ('82000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', 'Override RLS Salon B', 'override-rls-salon-b');

set local role service_role;
insert into public.billing_access_overrides (
  salon_id, plan_id, override_type, reason
) select
  '82000000-0000-4000-8000-000000000001', p.id, 'internal', 'Automated RLS regression fixture'
from public.plans p where p.slug = 'pro';

insert into public.billing_access_overrides (
  salon_id, plan_id, override_type, reason
) select
  '82000000-0000-4000-8000-000000000002', p.id, 'pilot', 'Automated cross-tenant RLS fixture'
from public.plans p where p.slug = 'pro';

do $$ begin
  if not exists (select 1 from public.billing_access_overrides where salon_id = '82000000-0000-4000-8000-000000000001') then
    raise exception 'SERVICE_ROLE_SELECT_FAILED';
  end if;
end $$;

update public.billing_access_overrides
set enabled = false
where salon_id = '82000000-0000-4000-8000-000000000001';
update public.billing_access_overrides
set enabled = true
where salon_id = '82000000-0000-4000-8000-000000000001';
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
do $$
declare denied boolean;
begin
  denied := false;
  begin perform 1 from public.billing_access_overrides where salon_id = '82000000-0000-4000-8000-000000000001'; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'OWNER_A_OWN_OVERRIDE_SELECT_ALLOWED'; end if;

  denied := false;
  begin perform 1 from public.billing_access_overrides where salon_id = '82000000-0000-4000-8000-000000000002'; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'OWNER_A_CROSS_TENANT_OVERRIDE_SELECT_ALLOWED'; end if;

  denied := false;
  begin
    insert into public.billing_access_overrides (salon_id, plan_id, override_type, reason)
    select '82000000-0000-4000-8000-000000000001', p.id, 'support', 'Forbidden insert'
    from public.plans p where p.slug = 'starter';
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'AUTHENTICATED_INSERT_ALLOWED'; end if;

  denied := false;
  begin update public.billing_access_overrides set enabled = false; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'AUTHENTICATED_UPDATE_ALLOWED'; end if;

  denied := false;
  begin delete from public.billing_access_overrides; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'AUTHENTICATED_DELETE_ALLOWED'; end if;
end $$;
reset role;

set local role anon;
do $$
declare denied boolean := false;
begin
  begin perform 1 from public.billing_access_overrides; exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'ANON_SELECT_ALLOWED'; end if;
end $$;
reset role;

rollback;
