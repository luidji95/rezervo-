# Billing webhook retry worker — environment-isolated runbook

Worker ponovo obrađuje samo trajno sačuvane, prethodno potpisom potvrđene Lemon Squeezy događaje `subscription_created` i `subscription_updated` koji su ostali u statusu `received`. Ne poziva Lemon Squeezy API, ne obrađuje granularne payment događaje i nikada automatski ne vraća `manual_review` događaj u `received`.

## Odvojeni test i live contract

Test i live worker koriste isti sekvencijalni core i v2 subscription procesore, ali imaju odvojene rute, capability flagove, secrets i batch veličine:

```text
POST /api/internal/billing/process-pending/test
BILLING_WORKER_ENABLED=false
BILLING_WORKER_SECRET=
BILLING_WORKER_BATCH_SIZE=10

POST /api/internal/billing/process-pending/live
BILLING_LIVE_WORKER_ENABLED=false
BILLING_LIVE_WORKER_SECRET=
BILLING_LIVE_WORKER_BATCH_SIZE=5
```

Legacy `POST /api/internal/billing/process-pending` ostaje compatibility alias sa compile-time literalom `test`. Svaka ruta zahteva prazan POST, bez query parametara, i tačan environment-specific `Authorization: Bearer` secret. `BILLING_ENVIRONMENT` deployment potvrđuje literal rute; request, payload, `NODE_ENV` i `VERCEL_ENV` ne mogu izabrati environment. Nema fallbacka između test i live flagova ili secret-a.

Oba workera su default `false`. Live worker nema GitHub workflow ni schedule i nijedan live secret nije u repozitorijumu. Pravi live checkout ostaje zabranjen dok live retry/recovery foundation ne bude review-ovan, ručno primenjen i posebno prihvaćen.

## SQL claim, lease i recovery

Migracija `202607300031_environment_aware_billing_webhook_retry.sql` dodaje `claim_pending_billing_webhook_events_v2`. Claim prima trusted `test|live`, vraća environment i bira isključivo isti environment. Dependency za `subscription_updated` se proverava prema istom normalized provider subscription ID-u, provideru i environmentu.

Attempt limit ostaje sedam. Backoff ostaje 1 minut, 5 minuta, 15 minuta, 1 sat, 6 sati i 24 sata. Sedmi neuspešni pokušaj završava kao `manual_review` sa sanitizovanim kodom `processor_retry_exhausted`. Lease traje pet minuta; expired lease omogućava naredni claim. Aktivni lease i `FOR UPDATE SKIP LOCKED` sprečavaju paralelni double claim.

Response i jedini dozvoljeni aggregate log sadrže samo postojeće brojače: `claimed`, `processed`, `alreadyTerminal`, `retried`, `manualReview` i `claimLost`. Ne logovati event, checkout, subscription, salon ili provider ID, payload, custom data, PII, secret, SQL detalj ili stack trace.

## Checkout `creating` granica

Retry worker može pomoći samo ako je potpisani webhook event već ingestovan. Ako checkout ledger ostane `creating`, a webhook nikada nije stigao:

1. ne praviti novi checkout sa istim idempotency key-em;
2. ne označavati ledger ručno kao `failed`;
3. proveriti Lemon Squeezy dashboard i webhook deliveries;
4. operator može zatražiti resend originalnog potpisanog eventa;
5. ne menjati subscription ili provider metadata ručno;
6. provider retrieval/checkout reconciliation ostaje posebna naredna faza.

## Buduća live automatizacija

Live schedule se ne dodaje u ovoj fazi. Budući workflow mora imati zaseban Production URL, live worker secret, schedule kill switch i concurrency grupu. Ne sme koristiti sandbox URL, sandbox worker secret ili postojeći sandbox reconciliation workflow/secret. Početni workflow treba da bude manual-only dok se ne završi kontrolisana live acceptance provera.
