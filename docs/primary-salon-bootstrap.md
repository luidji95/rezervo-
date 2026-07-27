# Primary salon bootstrap

Rezervo currently supports one primary salon per owner profile. PostgreSQL is the authority for that invariant.

## Contract

`public.create_primary_salon_once_v1()` authenticates with `auth.uid()`, takes a transaction advisory lock scoped to that profile, and checks for an existing salon before attempting creation. A new salon, active owner membership, and the existing trigger-created 14-day Pro trial are committed in one transaction. A retry returns the existing salon with `was_created = false` and does not rewrite salon or trial data.

The named `salons_owner_id_unique` constraint is the final concurrency guard. Slug collisions use a bounded numeric suffix. Missing owner membership may be healed only when no membership row exists; a conflicting role or status fails with `OWNER_MEMBERSHIP_CONFLICT`.

The RPC never accepts an owner ID. It accepts only the onboarding fields currently used by the product and does not expose billing metadata.

## Rollout

1. Run `primary-salon:audit` read-only and stop on any inconsistency.
2. Apply `202607270015_primary_salon_bootstrap.sql` while the old app remains compatible.
3. Deploy the onboarding refactor that calls the RPC.
4. After the deployment is Ready, apply `202607270016_harden_primary_salon_bootstrap_grants.sql`.
5. Verify direct authenticated inserts into `salons` and owner bootstrap inserts into `salon_members` are denied.

The second migration retains authenticated SELECT policies and trusted `service_role` table access. Invitation acceptance is unaffected because it uses its own SECURITY DEFINER RPC.

## Tests

- `pnpm test:primary-salon-bootstrap`
- `pnpm test:primary-salon-concurrency`

Both tests target only the disposable local Supabase database. They must never be used to create production tenants.
