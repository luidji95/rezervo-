# Billing subscription reconciliation sandbox runbook

Ovaj read-only worker proverava samo već povezane Lemon Squeezy test pretplate. Ne menja `subscriptions`, plan, checkout, webhook događaje, override ili entitlements i ne otkriva provider pretplate koje nemaju lokalni `provider_subscription_id`.

1. Ručno primeniti `202607290025_read_only_subscription_reconciliation.sql` i potvrditi da migration history završava na `025`.
2. Potvrditi RLS nad `billing_subscription_reconciliation_checks`: browser uloge nemaju pristup, `service_role` ima samo `SELECT`, a sva pisanja prolaze kroz service-role-only RPC funkcije.
3. U kontrolisanom Vercel Preview scope-u postaviti, bez prikazivanja vrednosti:
   - `BILLING_RECONCILIATION_ENABLED=true`
   - `BILLING_RECONCILIATION_SECRET=<nov, jak i odvojen secret>`
   - `BILLING_RECONCILIATION_BATCH_SIZE=10`
   - postojeće Lemon Squeezy test API/Store promenljive.
4. Redeployovati Preview. Ne menjati production flag.
5. Pozvati `POST /api/internal/billing/reconcile-linked-subscriptions` sa praznim body-jem i `Authorization: Bearer <BILLING_RECONCILIATION_SECRET>`.
6. Secret nikada ne slati kroz chat, URL, screenshot ili log. Supabase user token nije zamena.
7. Proveriti samo sanitizovani agregatni summary; endpoint ne vraća check, salon, subscription ili provider identifikatore.
8. U DB-u proveriti PII-free check redove. Tabela ne čuva provider subscription/customer/order ID, email, ime, karticu, URL ili raw response.
9. Uporediti fingerprint poslovnih tabela pre/posle i potvrditi da `subscriptions`, `plans`, checkout, webhook events i override nisu promenjeni.
10. Vratiti `BILLING_RECONCILIATION_ENABLED=false` dok zasebna Cron faza nije odobrena.

Provider 404 je samo `provider_not_found`, ne lokalni `expired`. Identity/mapping/plan-change/pause/trial drift je audit signal bez automatske korekcije. Full-store discovery, nepoznate provider pretplate i automatska korekcija pripadaju kasnijim fazama.
