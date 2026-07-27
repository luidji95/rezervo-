# Appointment mutation contract

Existing appointments remain readable when salon access becomes read-only.
Business writes require `resolve_salon_access_v1(...).has_full_access` and pass
through narrow RPCs. Browser roles have SELECT-only table access.

- Owner/manager create: `create_owner_appointment_atomic_v1`
- Owner/manager status: `update_owner_appointment_status_v1`
- Owner/manager reschedule: `reschedule_owner_appointment_v1`
- Owner/manager notes: `update_owner_appointment_notes_v1`
- Owner/manager client/details modal: `update_owner_appointment_details_v1`
- Employee create/status retain their existing service-role RPCs with a new
  canonical access gate.

Status transitions preserve the previous product contract: pending may become
confirmed, completed or cancelled; confirmed may become completed, cancelled
or no-show. Terminal states cannot move backwards. Reschedule is limited to
pending/confirmed appointments, recalculates duration/price snapshots, clears
`reminder_sent_at`, and cancels unfinalized deliveries for the old schedule.

Simulation/recovery and reminder metadata remain trusted server operations;
they do not use browser grants. Notifications are requested only after a
successful RPC result. Phase 6C will separately harden client/service writes.

Rollout is deliberately two-stage: deploy migration 006 gateways, deploy the
compatible application, then apply migration 007 to remove legacy writes.
