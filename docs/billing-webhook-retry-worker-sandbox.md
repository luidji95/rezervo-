# Billing webhook retry worker — sandbox runbook

Worker ponovo obrađuje samo trajno sačuvane Lemon Squeezy test događaje `subscription_created` i `subscription_updated` koji su ostali u statusu `received`. Ne poziva provider API, ne obrađuje live događaje i nikada automatski ne vraća `manual_review` događaj u `received`.

## Rollout

1. Pregledati i ručno primeniti migraciju `202607290024_billing_webhook_retry_worker.sql`.
2. Potvrditi da `anon` i `authenticated` nemaju EXECUTE, a `service_role` ima EXECUTE nad oba worker RPC-ja.
3. U isključivo kontrolisani Vercel Preview scope postaviti:

   ```text
   BILLING_WORKER_ENABLED=true
   BILLING_WORKER_SECRET=<novi jaki server-only secret>
   BILLING_WORKER_BATCH_SIZE=10
   ```

4. Redeployovati Preview. Ne menjati production flag u ovoj fazi.
5. Bezbedno kreirati ili izabrati kontrolisani test event koji je već validno ingestovan i ostao `received`.
6. Ručno poslati prazan zahtev:

   ```text
   POST /api/internal/billing/process-pending
   Authorization: Bearer <BILLING_WORKER_SECRET>
   ```

7. Proveriti isključivo agregatni response: `claimed`, `processed`, `alreadyTerminal`, `retried`, `manualReview`, `claimLost`.
8. Server-side SQL proverom pregledati retry metadata ciljnog test eventa: attempt count, poslednji pokušaj, sledeći pokušaj, outcome i lease stanje. Ne iznositi provider ili tenant identifikatore u dokumentaciju.
9. Ponoviti poziv radi potvrde da aktivan lease i terminalni eventi nisu ponovo claimovani.
10. Vratiti `BILLING_WORKER_ENABLED=false` nakon testa dok automatski scheduler nije zasebno odobren i uveden.

Worker secret se nikada ne šalje kroz query string, chat, screenshot, browser kod ili log. Endpoint ne prihvata Supabase korisničku sesiju kao alternativu. Vercel Cron nije konfigurisan ovom fazom.

## Backoff i recovery

Worker claim pokušaji koriste raspored 1 minut, 5 minuta, 15 minuta, 1 sat, 6 sati i 24 sata. Sedmi neuspešni pokušaj završava kao `manual_review` sa sanitizovanim kodom `processor_retry_exhausted`. Lease traje pet minuta. Ako instanca prestane pre finalizacije, istekao lease omogućava naredni claim; ako je processor ipak commitovao `processed`, DB terminalni status ima prednost.

`subscription_updated` je blokiran dok matching `subscription_created` za isti normalizovani provider subscription ID ostaje `received`. Custom data se ne koristi kao autoritet.
