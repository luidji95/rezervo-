# Business data mutation contract (Phase 6C)

`clients`, `services`, `service_categories`, and `employee_services` remain
tenant-readable, but authenticated browser roles have no direct table write
privileges. Owner/manager mutations use narrow SECURITY DEFINER RPCs. Every RPC
derives the actor from `auth.uid()`, verifies same-salon owner/active-manager
scope, and calls `resolve_salon_access_v1()` through
`assert_salon_admin_write_access_v1()`. Read-only access produces the stable
`SALON_WRITE_ACCESS_REQUIRED` code.

The rollout is deliberately split:

1. Apply `202607270009_business_data_mutation_gateways.sql`.
2. Deploy application call-sites that use the gateways.
3. Smoke-test the compatible client/service/assignment paths.
4. Apply `202607270010_harden_business_data_mutation_grants.sql`.
5. Run the bypass test and schema parity check.

Client deletion archives a client with appointment history and physically
deletes only a client with no appointments. Service deletion deactivates a
service that has appointment history or employee assignments; historical
appointment snapshots are never rewritten. A category with services cannot be
deleted. Employee/service list replacement is one transaction: every service
is validated before any assignment changes are made.

Onboarding receives its Pro trial from the salon trigger before service writes
and creates the owner membership before calling the same service gateways.
Appointment and public-booking SECURITY DEFINER functions retain their trusted
internal table access and their existing independent access checks.

The frozen baseline is unchanged. New environments apply baseline + cutover
seed, then all post-cutover migrations including 009 and 010.
