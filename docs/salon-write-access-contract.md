# Salon write access contract (Phase 6D)

Business settings remain readable when a salon is read-only, but mutations require `resolve_salon_access_v1(...).has_full_access`. The stable rejection is `SALON_WRITE_ACCESS_REQUIRED`.

Authenticated application mutations use narrow RPCs for salon profile/onboarding state, working hours and closures. Team invitations and reminder settings use authenticated server routes and the same central entitlement result. Direct browser mutation grants are removed from salons, working hours, closures, resources and integrations; the owner-only initial salon and membership bootstrap remains available through its existing insert policies.

Personal profile changes and notification read state are not business mutations and remain available. Invitation acceptance remains available because it links an already-created employee/member; creation of a new invitation requires full access. No resource or integration mutation UI currently exists, so those tables are read-only until a dedicated gateway is introduced.

Rollout is two-step: deploy code that uses migration `202607270012` RPCs, then apply `202607270013` to remove old grants. Roll back only the grants migration during an app/DB compatibility incident; do not remove access checks from gateway functions.
