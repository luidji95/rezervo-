# Lemon Squeezy sandbox webhook ingestion runbook

Phase 7B.2A receives and records signed test deliveries only. It does not update subscriptions, plans, entitlements or checkout sessions, and it does not call Lemon Squeezy APIs.

## Environment

Configure only in a private local or protected sandbox environment:

```text
BILLING_WEBHOOKS_ENABLED=true
BILLING_PROVIDER=lemonsqueezy
BILLING_ENVIRONMENT=test
LEMONSQUEEZY_WEBHOOK_SECRET=<test signing secret>
```

The signing secret must never use a `NEXT_PUBLIC_` name, appear in source control, command output, screenshots or logs. There is no signature bypass or unsigned development mode.

The provider endpoint is `POST /api/billing/webhooks/lemonsqueezy`. A real Lemon Squeezy test delivery requires this endpoint to be publicly reachable; use a protected Preview/staging environment with sandbox credentials. Do not enable it globally in production for this phase.

## Local signed request

Keep the secret in the local process environment and generate the HMAC from the exact raw JSON bytes with Node `createHmac("sha256", secret)`. Send that hex digest in `X-Signature` and the unchanged raw JSON as `Content-Type: application/json`. The helper or shell must print only the HTTP status and sanitized response, never the secret, signature or raw payload.

Expected responses:

- first allowlisted test event: `200 {"success":true,"status":"received"}`;
- exact repeated delivery: `200 {"success":true,"status":"duplicate"}`;
- semantic resend with a new `meta.webhook_id`: `200 {"success":true,"status":"duplicate"}`;
- signed unsupported event: `200 {"success":true,"status":"ignored"}`.

Changing whitespace or one character after signing must produce `BILLING_WEBHOOK_SIGNATURE_INVALID`.

## Delivery and semantic idempotency

`payload_hash` is the SHA-256 audit hash of the exact signed delivery body. It changes when raw whitespace, object key order or delivery metadata changes. `semantic_fingerprint` is SHA-256 of deterministically canonicalized validated JSON after removing only `meta.webhook_id`; object keys are recursively sorted and array order is preserved.

A real Lemon Squeezy Resend can generate a new `meta.webhook_id` and therefore a different raw payload hash for the same business event. `webhook_id` is not an idempotency key and is neither persisted nor unique. The resend must resolve through the semantic unique index and return `duplicate`. Signature verification always uses the original raw delivery body, never canonical JSON.

Rows created before migration `202607280019` may legitimately have a null semantic fingerprint because their raw payload was intentionally not stored and cannot be safely reconstructed. Do not backfill or delete those rows automatically. Every new application insert includes a non-null semantic fingerprint.

## Database audit

Using an operator-controlled server connection, inspect only minimal columns:

```sql
select id, provider, environment, event_name, provider_object_type,
       provider_object_id, payload_hash, semantic_fingerprint,
       processing_status, received_at, processed_at
from public.billing_webhook_events
order by received_at desc
limit 20;

select provider, environment, payload_hash, count(*)
from public.billing_webhook_events
group by provider, environment, payload_hash
having count(*) > 1;

select provider, environment, semantic_fingerprint, count(*)
from public.billing_webhook_events
where semantic_fingerprint is not null
group by provider, environment, semantic_fingerprint
having count(*) > 1;
```

The second query must return no rows. Do not expose this table through a browser client.

Before and after delivery, compare fingerprints/counts for `plans`, `subscriptions` and `billing_checkout_sessions`; they must be identical. `received` means queued only for a future lifecycle phase, not processed or paid.

## Disable

Set `BILLING_WEBHOOKS_ENABLED=false`, restart/redeploy the sandbox, and confirm the endpoint returns `BILLING_WEBHOOK_DISABLED`. Remove the test secret from an environment that is no longer used. Do not configure a live secret or live webhook in Phase 7B.2A.
