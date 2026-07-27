# Rezervo database baseline

## Strategy and cutover

The reconstructive baseline is stored outside `supabase/migrations` in
`supabase/baseline/schema.sql`. This is deliberate: production already records
the historical migrations through `202607270001`, while those migrations do
not contain the original schema. Putting the baseline into the normal chain
would cause production to try to recreate existing objects.

The cutover is **after `202607270001_fix_salon_reminder_settings_tenant_rls.sql`**
and is machine-readable in `supabase/baseline/cutover.txt`. Existing production
keeps its migration history unchanged. Future migrations keep their normal,
strictly increasing timestamps and are applied to production normally. A new
environment applies the baseline and reference seed, then applies only
migrations whose timestamp is greater than the cutover marker.

`202607220000_production_recovery.sql` is a historical production data-fix. It
contains appointment identifiers and is never executed for a new environment.
The baseline captures the resulting schema contract but contains none of those
rows.

## Sources and scope

The schema was generated with Supabase CLI 2.109.1 from read-only production
introspection, then completed with the required extension declarations and the
Auth signup trigger. It includes the final `public` and `private` objects,
constraints, indexes, functions, triggers, RLS, policies and grants at cutover.

The application extensions are `pgcrypto` and `btree_gist`. Operational
extensions are `pg_cron`, `pg_net` and `supabase_vault`; they are installed so
the function contract can be reconstructed, but the baseline does not create
Vault values or schedule a Cron job.

The only reference data is the plan catalogue in
`supabase/baseline/reference_seed.sql`. It mirrors the historical EUR production
contract at cutover; it is not the current catalogue. Post-cutover migration
`202607270003_normalize_plan_catalog_and_billing_provider.sql` produces the
current RSD catalogue. The frozen seed must not be rewritten to hide that
history.

## Bootstrap a new environment

Never run these commands against the linked production project. Start an
isolated local Supabase project or use a separately created disposable test
project. For a local database container named `<container>`:

```powershell
Get-Content supabase/baseline/schema.sql -Raw |
  docker exec -i <container> psql -v ON_ERROR_STOP=1 -U postgres -d postgres
Get-Content supabase/baseline/local_platform_grant_normalization.sql -Raw |
  docker exec -i <container> psql -v ON_ERROR_STOP=1 -U postgres -d postgres
Get-Content supabase/baseline/reference_seed.sql -Raw |
  docker exec -i <container> psql -v ON_ERROR_STOP=1 -U postgres -d postgres
Get-Content supabase/baseline/tests/clean_baseline_smoke.sql -Raw |
  docker exec -i <container> psql -v ON_ERROR_STOP=1 -U postgres -d postgres
```

For later migrations, read the marker and apply only files newer than it. Do
not run root `supabase db reset` against the historical chain:

```powershell
$cutover = (Get-Content supabase/baseline/cutover.txt -Raw).Trim()
Get-ChildItem supabase/migrations/*.sql |
  Where-Object { $_.BaseName.Split('_')[0] -gt $cutover } |
  Sort-Object Name
```

Review that list and apply it through the normal migration workflow of the new
environment. Never mark historical migrations as applied merely to suppress an
error.

The grant-normalization artifact is bootstrap-only. Supabase local images can
have direct anon/authenticated function defaults before `schema.sql` is
restored; the artifact removes only the service-only EXECUTE grants that are
absent from production. It is not a production migration and does not modify
the frozen schema artifact.

The first normal post-cutover migration is
`202607270002_billing_access_overrides.sql`, followed by the plan/provider
normalization migration `202607270003_normalize_plan_catalog_and_billing_provider.sql`.
Employee capacity hardening follows in
`202607270004_employee_capacity_hardening.sql`.
Public booking subscription enforcement follows in
`202607270005_public_booking_subscription_access.sql`.
Clean-environment validation must
apply the frozen baseline, reference seed, and every migration newer than the
cutover marker before smoke, RLS, parity and type-generation checks. The frozen
`schema.sql` is not rewritten for post-cutover objects.

## Validation and parity

The smoke test is transactional and proves Auth profile creation, salon and
owner membership bootstrap, the 14-day Pro trial, core writes, overlap
exclusion, notification routing, reminder and public-booking contracts, RLS
enablement, tenant isolation and the allowed anonymous public surface.

For read-only production parity, set `BASELINE_DB_CONTAINER` to the disposable
container and `SUPABASE_PROJECT_REF` to the linked project reference, then run:

```powershell
pnpm baseline:parity
```

The checker compares enums, columns, constraints, indexes, function signatures,
triggers, RLS state, policies and grants. It prints no schema content or secret.
Data, Auth users, timestamps, UUIDs, Vault values, Cron jobs and environment
owners are outside the contract.

One intentional difference is documented: production retains the redundant
`subscriptions_select_owner_or_manager` policy. The canonical baseline keeps
only `subscriptions_owner_manager_read`. Production cleanup belongs in a later
dedicated migration and is not part of this baseline.

## Generated TypeScript types

Generate types only from the validated disposable baseline database:

```powershell
npx --yes supabase@2.109.1 gen types typescript `
  --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres `
  | Set-Content src/types/database.generated.ts
```

The generated file is schema-only and must not contain environment values,
tenant data or secrets. Phase 1 does not migrate existing call sites to it.

## Optional Vault and Cron operations

After the endpoint has been deployed and validated separately, an operator may
create the named Vault secrets and use
`supabase/snippets/reminder_cron_operations.sql`. The baseline itself never
creates secret values, worker URLs, Bearer credentials or a scheduled job.
Emergency stop remains the documented `cron.unschedule` operation plus the
server runtime flag. Existing production Cron and Vault state are not changed
by this procedure.

## Recovery

Recovery is two separate operations:

1. Reconstruct an empty schema with the baseline, reference seed and all
   post-cutover migrations, then pass smoke and parity checks.
2. Restore tenant/Auth data from an independently controlled backup only after
   schema verification.

Never mix schema reconstruction with data backup restoration, and never use a
production reset as a recovery shortcut.
