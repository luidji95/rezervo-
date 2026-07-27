# Public booking subscription access

Public booking is effective only when the salon keeps its own `status`,
`booking_enabled`, and `online_booking_enabled` settings enabled **and** the
canonical subscription/override resolver returns full access. Subscription
expiry never mutates those user settings or any existing booking.

`public.resolve_salon_access_v1(salon_id, now)` is the internal DB contract.
It gives precedence to an active billing override, then applies the canonical
trial/active/cancelled lifecycle (including the temporary legacy-active rule),
and otherwise fails closed. It is not executable by browser roles.

Public booking data uses server-only bootstrap and availability endpoints.
Anonymous direct reads of services, employees, employee-service links,
working hours, and closures are revoked. The public salon profile remains
readable so an existing URL can show the neutral message “Online zakazivanje
trenutno nije dostupno.” without exposing billing details.

Availability is an early UX gate. `create_public_booking_atomic` repeats the
access decision inside its transaction before client or appointment writes.
It locks only the relevant salon, subscription, and override rows. A successful
idempotent retry is resolved before this gate, so expiry after a successful
booking does not hide the already-created appointment. Rejected attempts do not
reserve an idempotency key and create no client, appointment, snapshot, or
notification side effects.

Operator audits should report only aggregate counts of salons whose public
booking flags are enabled but whose resolved access is read-only. Future owner
and employee write enforcement phases should reuse this resolver rather than
copying lifecycle rules.
