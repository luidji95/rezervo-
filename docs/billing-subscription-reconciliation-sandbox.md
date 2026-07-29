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

Operational foundation koristi manual-only GitHub Actions `workflow_dispatch`. `pg_cron + pg_net` pristup je odbačen za trenutnu Supabase instalaciju zato što `pg_net` request queue privremeno skladišti authorization headere, dok migration rola ne može pouzdano održavati zahtevani ACL nad extension-owned `net` objektima. Rezervo ne pokušava platform-level `REVOKE` i ne menja Vault ili `pg_net` objekte.

Workflow zahteva jednu GitHub repository/environment promenljivu:

- `BILLING_RECONCILIATION_URL` — stabilan `.vercel.app` branch Preview alias sa tačnom reconciliation endpoint putanjom, nikada deployment-specific URL.

Potrebne su dve potpuno odvojene GitHub Actions tajne:

- `BILLING_RECONCILIATION_SECRET` — autorizuje Rezervo internal endpoint;
- `VERCEL_AUTOMATION_BYPASS_SECRET` — prolazi Vercel Authentication kroz `x-vercel-protection-bypass`.

Vercel Authentication ostaje uključena. Workflow šalje zero-body POST sa `Content-Length: 0`; ne šalje JSON, query parametre, Supabase ključ, worker secret ili bypass cookie. Operator mora u autentifikovanom Vercel dashboardu potvrditi da URL predstavlja stabilan branch alias koji prati nove deploymente, jer `.vercel.app` hostname sam po sebi ne dokazuje pouzdano da URL nije deployment-specific.

Workflow je trenutno samo ručni. Nema `schedule`, `push`, `pull_request` ili drugog automatskog triggera.

GitHub workflow discovery i execution ref su dva odvojena koraka:

1. Workflow fajl mora postojati na repository default grani da bi `workflow_dispatch` bio dostupan kroz Actions UI, CLI ili API.
2. Kada je workflow tako dostupan, operator za manual run bira `billing-webhook-sandbox` kao execution branch/ref.
3. Budući `schedule` takođe zahteva workflow na default grani, ali schedule trigger još nije dodat.

Bezbedan bootstrap je workflow-only promena: prvo se workflow fajl priprema kao zaseban commit, a zatim se samo taj mali commit prenosi na default granu kroz namenski PR ili cherry-pick. Cela billing grana se ne mergeuje automatski samo radi workflow discovery-ja. Tek kada workflow postoji na default grani, radi se manual acceptance sa `expected_status=503` i izabranim `billing-webhook-sandbox` refom.

Prvi acceptance run koristi `expected_status=503` dok je `BILLING_RECONCILIATION_ENABLED=false`. Kasniji kontrolisani test koristi `expected_status=200`. Kill switch ostaje `BILLING_RECONCILIATION_ENABLED=false`, a workflow se dodatno može disable-ovati u GitHub Actions podešavanjima.

Nikada ne prikazivati ili screenshotovati GitHub secret vrednosti, kompletne request komande, Actions debug secret output ili nefiltriran response. Workflow prikazuje samo HTTP status za očekivani fail-closed rezultat ili osam allowlistovanih agregatnih summary polja za uspešan rezultat.

### Branch alias redirect handling

Stabilan branch Preview alias može vratiti HTTP redirect pre nego što zahtev stigne do aplikacionog endpointa. HTTP 302 zato sam po sebi ne potvrđuje niti osporava ispravnost `BILLING_RECONCILIATION_SECRET` vrednosti.

Workflow nikada ne koristi slepo automatsko praćenje redirecta. Dozvoljen je najviše jedan eksplicitni redirect za 301, 302, 307 ili 308. `Location` se prvo parsira standardnim URL parserom i target mora imati HTTPS, tačnu reconciliation putanju, bez credentials, porta, query-ja ili fragmenta. Host mora pripadati istom Vercel project/team namespace-u izvedenom iz konfigurisanog `billing-webhook-sandbox` branch aliasa. Tek posle uspešne validacije oba security headera se ponovo šalju direktno validiranom targetu.

Vercel Authentication/login redirect, drugi projekat, drugi redirect ili bilo koji neočekivani target odbija se bez prikazivanja `Location` vrednosti, response headera ili HTML body-ja.
