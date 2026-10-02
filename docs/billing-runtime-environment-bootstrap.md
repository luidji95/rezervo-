# Billing runtime environment bootstrap

Migration `202608240038_database_owned_billing_environment_authority.sql` creates
the private singleton configuration but intentionally does not insert a value.
Provider-backed entitlements fail closed until a PostgreSQL administrator sets it.

Do not expose this operation through PostgREST or an application endpoint. Run the
appropriate block only in the Supabase SQL editor as an administrator, immediately
after applying the migration.

## Test project

```sql
begin;

insert into private.billing_runtime_config(singleton, environment, updated_at)
values (true, 'test', pg_catalog.now())
on conflict (singleton) do update
set environment = excluded.environment,
    updated_at = pg_catalog.now();

do $$
declare
  v_count bigint;
  v_environment text;
begin
  select pg_catalog.count(*), pg_catalog.min(environment)
    into v_count, v_environment
  from private.billing_runtime_config;

  if v_count <> 1 or v_environment <> 'test' then
    raise exception 'BILLING_RUNTIME_ENVIRONMENT_BOOTSTRAP_FAILED';
  end if;
end
$$;

commit;

select singleton, environment, created_at, updated_at
from private.billing_runtime_config;
```

## Production project

```sql
begin;

insert into private.billing_runtime_config(singleton, environment, updated_at)
values (true, 'live', pg_catalog.now())
on conflict (singleton) do update
set environment = excluded.environment,
    updated_at = pg_catalog.now();

do $$
declare
  v_count bigint;
  v_environment text;
begin
  select pg_catalog.count(*), pg_catalog.min(environment)
    into v_count, v_environment
  from private.billing_runtime_config;

  if v_count <> 1 or v_environment <> 'live' then
    raise exception 'BILLING_RUNTIME_ENVIRONMENT_BOOTSTRAP_FAILED';
  end if;
end
$$;

commit;

select singleton, environment, created_at, updated_at
from private.billing_runtime_config;
```

The deployment must also set server `BILLING_ENVIRONMENT` to the same exact value.
Treat the SQL read-back and `BILLING_ENVIRONMENT` comparison as a mandatory release
check. Do not apply the migration to a project serving traffic unless the matching
bootstrap block can be run immediately; the intentional interval without a row
denies provider-backed access.
