begin;

alter table public.billing_webhook_events
  add column semantic_fingerprint text;

alter table public.billing_webhook_events
  add constraint billing_webhook_events_semantic_fingerprint_check
  check (
    semantic_fingerprint is null
    or semantic_fingerprint ~ '^[0-9a-f]{64}$'
  );

create unique index billing_webhook_events_semantic_unique
  on public.billing_webhook_events(provider, environment, semantic_fingerprint)
  where semantic_fingerprint is not null;

comment on column public.billing_webhook_events.semantic_fingerprint is
  'SHA-256 of canonical validated business payload excluding only meta.webhook_id. Null is retained for pre-019 rows.';

commit;
