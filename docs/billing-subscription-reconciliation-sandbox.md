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

## GitHub Actions operational trigger

Operational foundation koristi GitHub Actions `workflow_dispatch` i kontrolisani sandbox `schedule`. `pg_cron + pg_net` pristup je odbačen za trenutnu Supabase instalaciju zato što `pg_net` request queue privremeno skladišti authorization headere, dok migration rola ne može pouzdano održavati zahtevani ACL nad extension-owned `net` objektima. Rezervo ne pokušava platform-level `REVOKE` i ne menja Vault ili `pg_net` objekte.

Workflow zahteva dve GitHub repository/environment promenljive:

- `BILLING_RECONCILIATION_URL` — stabilan `.vercel.app` branch Preview alias sa tačnom reconciliation endpoint putanjom, nikada deployment-specific URL.
- `BILLING_RECONCILIATION_SCHEDULE_ENABLED` — neosetljiv schedule kill switch; samo tačna vrednost `true` dozvoljava scheduled HTTP poziv.

Potrebne su dve potpuno odvojene GitHub Actions tajne:

- `BILLING_RECONCILIATION_SECRET` — autorizuje Rezervo internal endpoint;
- `VERCEL_AUTOMATION_BYPASS_SECRET` — prolazi Vercel Authentication kroz `x-vercel-protection-bypass`.

Vercel Authentication ostaje uključena. Workflow šalje zero-body POST sa `Content-Length: 0`; ne šalje JSON, query parametre, Supabase ključ, worker secret ili bypass cookie. Operator mora u autentifikovanom Vercel dashboardu potvrditi da URL predstavlja stabilan branch alias koji prati nove deploymente, jer `.vercel.app` hostname sam po sebi ne dokazuje pouzdano da URL nije deployment-specific.

Workflow nema `push`, `pull_request` ili drugi repository trigger. Ručni trigger ostaje dostupan nezavisno od schedule kill switcha. Sandbox schedule koristi `17 */6 * * *`: jednom na šest sati u 17. minutu po UTC vremenu. GitHub može započeti izvršavanje sa manjim kašnjenjem tokom opterećenja scheduler-a.

GitHub workflow discovery i execution ref su dva odvojena koraka:

1. Workflow fajl mora postojati na repository default grani da bi `workflow_dispatch` bio dostupan kroz Actions UI, CLI ili API.
2. Kada je workflow tako dostupan, operator za manual run bira `billing-webhook-sandbox` kao execution branch/ref.
3. `schedule` takođe izvršava samo workflow verziju dostupnu na default grani.

Bezbedan bootstrap je workflow-only promena: prvo se workflow fajl priprema kao zaseban commit na `billing-webhook-sandbox`, a zatim se samo taj mali commit prenosi na default granu kroz namenski PR ili cherry-pick. Documentation/test commit ostaje na billing grani do završnog billing merge-a. Cela billing grana se ne mergeuje automatski samo radi workflow discovery-ja ili schedule-a. Workflow na default grani i dalje poziva stabilan `rezervo-app` branch Preview alias iz GitHub promenljive; stvarni URL se ne hardkoduje.

Manual acceptance i dalje podržava `expected_status=503` dok je `BILLING_RECONCILIATION_ENABLED=false`, kao i kontrolisani `expected_status=200` test. Scheduled run interno uvek očekuje HTTP 200; HTTP 503 zato predstavlja operativni failure koji pokazuje da aplikacioni kill switch ili deployment konfiguracija nisu spremni.

Schedule još nije operativno aktivan dok `BILLING_RECONCILIATION_SCHEDULE_ENABLED` nije eksplicitno postavljen na `true` i workflow-only commit nije dostupan na default grani. Tri nivoa gašenja su:

1. `BILLING_RECONCILIATION_SCHEDULE_ENABLED=false` sprečava novi scheduled HTTP poziv.
2. Workflow se može disable-ovati u GitHub Actions UI-ju.
3. `BILLING_RECONCILIATION_ENABLED=false` zaustavlja endpoint fail-closed sa HTTP 503 nakon redeploya.

Za hitno gašenje prvo postaviti repository schedule promenljivu na `false`, zatim postaviti aplikacioni flag na `false` i redeployovati, po potrebi disable-ovati workflow, a tek zatim po potrebi rotirati Vercel bypass ili reconciliation secret. Za privremenu pauzu dovoljan je prvi korak. Operator u Actions logu pregleda samo očekivani status i sanitizovani summary (`claimed`, `inSync`, `remoteNewerEquivalent`, `driftDetected`, `manualReview`, `providerUnavailable`, `configurationError`, `claimLost`).

Nikada ne prikazivati ili screenshotovati GitHub secret vrednosti, kompletne request komande, Actions debug secret output ili nefiltriran response. Workflow prikazuje samo HTTP status za očekivani fail-closed rezultat ili osam allowlistovanih agregatnih summary polja za uspešan rezultat.

### Branch alias redirect handling

Stabilan branch Preview alias može vratiti HTTP redirect pre nego što zahtev stigne do aplikacionog endpointa. HTTP 302 zato sam po sebi ne potvrđuje niti osporava ispravnost `BILLING_RECONCILIATION_SECRET` vrednosti.

Workflow nikada ne koristi slepo automatsko praćenje redirecta. Dozvoljen je najviše jedan eksplicitni redirect za 301, 302, 307 ili 308. `Location` se prvo parsira standardnim URL parserom i target mora imati HTTPS, tačnu reconciliation putanju, bez credentials, porta, query-ja ili fragmenta. Host mora pripadati istom Vercel project/team namespace-u izvedenom iz konfigurisanog `billing-webhook-sandbox` branch aliasa. Tek posle uspešne validacije oba security headera se ponovo šalju direktno validiranom targetu.

Vercel Authentication/login redirect, drugi projekat, drugi redirect ili bilo koji neočekivani target odbija se bez prikazivanja `Location` vrednosti, response headera ili HTML body-ja.

### Execution budget

Jedno reconciliation worker izvršavanje ima fiksni ukupni monotonic execution budget od 55 sekundi. Budžet je kraći od GitHub Actions HTTP timeouta od 70 sekundi kako bi aplikacija imala prostor da finalizuje poslednji item i vrati odgovor.

Pre svakog novog claima worker zahteva više od 15 sekundi preostalog vremena: provider timeout contract je 10 sekundi, a dodatnih 5 sekundi rezervisano je za DB finalizaciju i endpoint response. Već claimovan item se ne prekida zbog ukupnog budžeta; njegov provider poziv ostaje ograničen zasebnim provider timeoutom i worker uvek pokušava finalizaciju pre sledeće provere budžeta.

Execution-budget stop nije retry razlog i ne claimuje niti povećava attempt count sledećem itemu. Batch size ostaje nezavisan hard limit, a postojeća pravila za configuration error, rate limit i provider greške ostaju na snazi. Schedule trigger postoji, ali scheduled HTTP pozivi ostaju isključeni dok repository schedule promenljiva nije tačno `true`.
