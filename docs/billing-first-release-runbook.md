# Prvi billing release — runbook i checklist

Cilj prvog release-a: kupovina Starter/Pro mesečnog paketa, prava posle potvrđene kupovine,
payment management i self-service otkazivanje (pristup do kraja plaćenog perioda) i jasno stanje
neuspele naplate sa postojećim recovery putem. Ostaju isključeni: C2 promena paketa, E1 ponovna
kupovina, E2 pilot → plaćeno. Interni Pro trial za nove salone traje 3 kalendarska meseca (migracija `202610280050`); postojeći saloni zadržavaju svoje datume.

Svaki odeljak A–F je zaseban korak sa sopstvenim odobrenjem i kriterijumom za zaustavljanje.
**„Billing radi live“ se ne tvrdi pre završenog odeljka E.**

## Stanje na dan 2026-10-23 (read-only, bez tajni)

Izvor: Supabase Management API i Vercel CLI preko postojećih prijava; samo `SELECT`/`GET`.

| Stavka | Stanje |
| --- | --- |
| Supabase cilj | jedini aktivni projekat `vsfdeb…` (org „Rezervo“, **free plan**), eu-west-1, PG 17.6.1.121 = `supabase/.temp/project-ref` |
| Managed backup / PITR | **nema**: `pitr_enabled=false`, 0 dostupnih backup-a (free plan) |
| Vercel cilj | `rezervo-app` (tim `luidji95s-projects`); `main` push → Production |
| Deployovan commit | SHA nije čitljiv preko dostupnog API-ja. **Pretpostavka:** `2efe3eb` (= `origin/main`); deploy kreiran 2026-10-06 09:45 CEST, 23 min posle tog commita |
| Remote history | 64 zapisa, poslednji `202609010043`; 044–049 nisu u history-ju |
| Drift | `billing_environment_matches_v1` (044) fizički postoji i identičan je lokalnom (telo, rezultat, `security definer`, `search_path=""`, owner `postgres`, ACL, komentar). Ceo katalog `public`/`private` (1.053 funkcije, kolone, triggeri, politike, indeksi, table ACL) poklapa se sa „baseline + migracije do 044“; jedine razlike su lokalni podrazumevani `anon`/`authenticated` EXECUTE grantovi na 12 funkcija (remote je strožiji; poznato, `supabase/baseline/local_platform_grant_normalization.sql`). Nijedan objekat iz 045–049 ne postoji |
| DB billing runtime | `test` |
| Planovi | Starter 2990 RSD/3 zaposlena, Pro 5990 RSD/10, aktivni; Premium neaktivan; godišnje `null` |
| Provider mapping | samo `test` Starter/Pro; nema `live` |
| Vercel Production env (imena) | od billing promenljivih samo `BILLING_ENVIRONMENT`; checkout, webhook, portal i retry worker su u produkciji isključeni jer nisu konfigurisani |
| Podaci | 6 salona, 8 auth korisnika; 6 pretplata (3 `test` provider-linked, 2 legacy bez providera, 1 trial); 1 aktivan override; nema `creating`/`open` checkout-a |
| Schedule | pg_cron samo `rezervo-sms-reminder-worker` (*/5). Billing retry worker nema schedule |
| Lemon Squeezy | identity verification „In Review“; live nije odobren |

## A. Preduslovi

### A1. Lemon Squeezy live (vlasnik naloga)

1. Live odobrenje store-a potvrđeno u dashboardu.
2. U **live** modu: Starter 2.990 RSD i Pro 5.990 RSD, mesečno, **bez provider trial-a**. Zabeležiti
   store/product/variant ID (nisu tajna).
3. Live API ključ i live webhook signing secret (unose se samo u Vercel, korak D).
4. Portal (Design → Customer Portal): isključeni promena paketa/varijante i pause; uključeni cancel/resume,
   payment method, billing podaci, istorija; Back link `<produkcijski URL>/settings?tab=billing`; isto na
   `https://<store>.lemonsqueezy.com/billing`. Zvanična dokumentacija ne navodi koje se akcije pojedinačno
   isključuju — potvrditi u dashboardu. **Ako pause ili promena paketa ne mogu da se isključe, portal se ne
   uključuje** i pre release-a se radi mala zamena (vidi „Blocker za portal“).

### A2. Backup i restore (obavezno pre B)

Managed backup ne postoji (free plan), pa je zaštita lokalni logički izvoz.

**Napravljen 2026-10-23** (read-only `SELECT` kroz Management API, `read_only: true`):

- lokacija van repoa: `C:\Users\User\rezervo-backups\20261023-pre-billing-release\`
  (NDJSON po tabeli + `manifest.json` sa brojem redova i SHA-256), ~13 MB;
- ACL: samo lokalni nalog `User` (nasleđivanje isključeno); nije u git-u, nije uploadovan;
- obuhvat: 38 tabela, 22.411 redova — sve tabele `public`, `private.billing_runtime_config`,
  `auth.users`, `auth.identities`, `supabase_migrations.schema_migrations`;
- **ne obuhvata:** Vault tajne (2), cron komande (1 job; samo ime/raspored u manifestu), auth sesije,
  refresh/one-time tokene, MFA, auth audit log, Storage (0 objekata, 0 bucket-a), Auth/projekat
  podešavanja, ekstenzije i platform šeme (šema se vraća iz migracija);
- nije atomski snapshot: tabele su čitane redom (baza bez stvarnih korisnika; SMS cron je radio).

**Restore test (izvršen):** novi disposable kontejner `--network none` (nema cron/webhook/email/SMS/
provider izlaza), šema = baseline + migracije do 044 (= remote), učitano 37 tabela: **0 razlika u broju
redova, 0 prekršenih FK**, history poslednji `202609010043`, runtime `test`, 0 cron job-ova. Zatim su nad
tom kopijom primenjene 045–049 bez greške (`acquire_…_v3` prisutan, `resolve_employee_capacity_v2` i
`resolve_salon_access_v1` vraćaju red za svih 6 salona). Kontejner obrisan.

**Granica:** `auth.identities` (8) nije vraćen u čist Postgres image (tu tabelu kreira GoTrue).
Praktičan restore postupak u slučaju potrebe: novi Supabase projekat (GoTrue kreira auth šemu) → baseline
+ migracije do potrebne verzije → učitavanje NDJSON-a sa `session_replication_role = replica` → ponovo
podesiti Vault tajne, cron, Auth URL/redirect i Vercel env. Skripte su lokalne (scratch), ne deo repoa;
pre B napraviti **svež** izvoz istim postupkom ako je od izvoza bilo upisa.

## B. Remote migracije (remote upis — zasebno odobrenje)

Cilj: projekat `vsfdeb…`. Aplikacija ostaje na starom kodu dok se B ne završi.

**Pokušaj 2026-10-24 — zaustavljeno pre bilo kakve mutacije (nema backup-a, repair-a ni primene).**
Read-only preflight: projekat `vsfdeb…` (jedini aktivni), history 64 zapisa do `202609010043`, pending tačno
044–049; 044 i dalje identična (md5 normalizovanog tela `773140f3…` = lokalno, `stable`, `security definer`,
`search_path=""`, owner `postgres`, ACL `postgres`/`service_role`, komentar); objekti 045–049 ne postoje;
runtime `test`; 0 `creating`/`open` checkout-a, 0 checkout-a u 7 dana. **Blocker:** Vercel Preview okruženje za
granu `billing-webhook-sandbox` (deploymenti `Ready`, kod `b5f066f`) ima postavljene `BILLING_CHECKOUT_ENABLED`,
`BILLING_WEBHOOKS_ENABLED`, `BILLING_WORKER_ENABLED`, `BILLING_RECONCILIATION_ENABLED`,
`BILLING_CUSTOMER_PORTAL_ENABLED`, `LEMONSQUEEZY_*` i deli `SUPABASE_SERVICE_ROLE_KEY`/URL sa Production-om;
`test` webhook-ovi su obrađeni u ovoj bazi 2026-10-21. Preduslov „checkout i webhook obrada onemogućeni tokom
prelaza“ zato nije dokazan. Kompatibilnost: Preview koristi podskup (54) već proverenih RPC-jeva čiji se potpis,
rezultat i ACL ne menjaju u 045–049. Sledeće zakazane sandbox obnove: 2026-10-28 i 2026-10-30.
Baseline otisci pre B (md5, bez sadržaja): pretplate `2cc30d6a…`, override-i `f67a00ff…`, mapping `53a57af3…`,
planovi `0753e8d0…`.

**Izvršeno 2026-10-24 (vlasnik je pisano prihvatio da Preview `billing-webhook-sandbox` ostane aktivan).**

1. Backup: `C:\Users\User\rezervo-backups\20261024-1508-pre-migration-045-049\` (38 tabela, 22.426 redova,
   ACL samo `User`; isti obuhvat i ograničenja kao A2, nije atomski). Restore u disposable `--network none`:
   37 tabela, 0 razlika u broju redova, 0 FK prekršaja (`auth.identities` platform-managed, preskočen);
   proba 045–049 nad kopijom uspešna; kontejner obrisan.
2. Neposredno pre mutacije: svi otisci, 044, runtime, checkout-i i webhook-ovi nepromenjeni; history 64/043.
3. `migration repair --status applied 202610050044 --linked` → history 65, poslednji `202610050044`.
4. Dry-run: CLI ne parsira `.env.local` (UTF-8 BOM); fajl nije menjan — CLI je pokrenut sa `--workdir` iz
   privremene kopije `supabase/` (config, identične migracije, link; bez env fajlova). Ponuđeno tačno 045–049.
5. `db push --linked --yes` (isti workdir): primenjene 045, 046, 047, 048, 049. Upozorenje „failed to cache
   migrations catalog (pg-delta certificate)“ odnosi se na lokalni CLI keš, ne na bazu.
6. Post-check (read-only): history 70 zapisa, 044–049 prisutne; 3 nove tabele sa RLS, `service_role` samo
   `select`, bez `anon`/`authenticated`; 22 billing funkcije `security definer` (private nisu), `search_path=""`,
   owner `postgres`, bez `anon`/`authenticated` EXECUTE; `set_employee_active_state` zadržava postojeći
   `authenticated` grant (nepromenjen ACL, interni `auth.uid()`); 5 novih triggera i 8 indeksa; kolone
   `resubscribe_from_*`; nove tabele prazne. Runtime `test`; otisci pretplata, override-a, mapping-a i planova
   identični; 0 `creating`/`open` checkout-a; nema novih billing događaja.
7. Javni smoke trenutnog Production deploya (samo GET, bez prijave): `/`, `/pricing`, `/auth/login`,
   `/auth/register` → 200; `/api/billing/overview`, `/api/entitlements` → 401. Prijavljeni tok nije testiran.

Sledeće: C (push/deploy sa svim billing flagovima isključenim) — zasebno odobrenje.

1. Svež izvoz (A2) ako je bilo izmena.
2. History repair **samo za 044** — opravdano jer je fizički primenjena i identična (dokaz gore); ponovno
   pokretanje bi palo (`create function` nad postojećom funkcijom):
   `npx --yes supabase@2.109.1 migration repair --status applied 202610050044 --linked`
   (CLI može tražiti DB lozinku — unosi je vlasnik lokalno).
3. Dry-run: `npx --yes supabase@2.109.1 db push --linked --dry-run`. Očekivano **tačno**:
   `202610170045_operator_billing_recovery.sql`, `202610180046_c1_trial_purchase_employee_capacity.sql`,
   `202610190047_c2_next_renewal_plan_change.sql`, `202610220048_c2_plan_change_operator_recovery.sql`,
   `202610230049_e1_resubscribe_after_expiry.sql`. Bilo šta drugo (npr. 044 ili nepoznata verzija) → stani.
4. `npx --yes supabase@2.109.1 db push --linked`.
5. Post-check (read-only):

```sql
select version from supabase_migrations.schema_migrations where version >= '202610050044' order by 1;  -- 044..049
select to_regprocedure('public.acquire_billing_checkout_intent_v3(uuid,uuid,uuid,text,boolean)') is not null,
       to_regprocedure('public.resolve_employee_capacity_v2(uuid,timestamptz)') is not null,
       to_regprocedure('public.resolve_billing_purchase_activation_v1(uuid)') is not null,
       to_regclass('public.billing_recovery_attempts') is not null,
       to_regclass('public.billing_subscription_plan_changes') is not null,
       to_regclass('public.billing_subscription_provider_generations') is not null;          -- sve true
select environment from private.billing_runtime_config;                                     -- 'test'
select has_function_privilege('authenticated','public.acquire_billing_checkout_intent_v3(uuid,uuid,uuid,text,boolean)','execute'),
       has_function_privilege('anon','public.resolve_employee_capacity_v2(uuid,timestamptz)','execute');  -- false, false
select count(*) from public.salons s cross join lateral public.resolve_salon_access_v1(s.id) a;  -- = broj salona
```

Stani ako: dry-run lista nije tačna; migracija padne (ne „popravljati“ ručnim SQL-om); post-check se
razlikuje. Povratak: migracije su transakcione (neuspela se ne primeni); za već primenjene vidi A2 restore.

## C. Deployment (push na `main` — zasebno odobrenje)

**Stari kod + nova šema: kompatibilno uz uslov.** Dokaz (disposable baza, šema 044 → 049):
svih 55 RPC-jeva koje poziva `2efe3eb` i dalje postoje sa istim argumentima, rezultatom,
`security definer`, `search_path`, volatilnošću i ACL-om; RLS politike nepromenjene; nema revoke-a na
postojeće objekte; dodati triggeri su na novim tabelama/kolonama ili `subscriptions` (aktivni samo uz
nerazrešenu C2 promenu). Promene ponašanja: `acquire_…_v2` je wrapper oko v3 i dodaje C1 odbijanja (stari
kod ih mapira u `503 BILLING_RECONCILIATION_REQUIRED` — fail-closed); procesori vraćaju iste ishode; employee
trigger sužava kapacitet samo uz `creating`/`open` checkout ili nerazrešenu promenu paketa;
`set_employee_active_state` dozvoljava deaktivaciju i u read-only režimu.
**Uslov:** između B i C checkout i webhook-ovi ostaju neuključeni u Production (trenutno tačno: nisu
konfigurisani), pa nema novih checkout-a ni procesiranja.

Novi kod zavisi od 045–049 (`/api/entitlements` → `resolve_employee_capacity_v2`, checkout → v3) — C nikad
pre B.

1. `git push origin main` (lokalno 8 commitova ispred `origin/main`, poslednji `c47466d`) → Vercel Production.
2. Bez novih env promenljivih.
3. Smoke, očekivano:
   - javne strane i `/pricing`; Premium „u pripremi“, bez CTA; nema godišnje ponude;
   - prijava test vlasnika → Settings → Plaćanje i plan: status, „Online nadogradnja uskoro“, bez checkout-a,
     portala, promene paketa i E1 poruke;
   - `/api/entitlements` 200 sa `employeeCapacity` (dokaz 046);
   - `/api/billing/webhooks/lemonsqueezy/live` → `404 BILLING_WEBHOOK_DISABLED`;
   - zaposleni: dodavanje/deaktivacija kao pre.
   Ako neki novi RPC vrati „not found“ odmah posle B, PostgREST keš šeme se osvežava sam; tek ako ne, vlasnik
   izvršava `notify pgrst, 'reload schema';`.

Stani ako: build pada ili smoke ne prolazi. Povratak: Vercel „Promote“ prethodnog deploya (kompatibilan sa
novom šemom, gore).

## D. Kontrolisano live uključivanje (DB + Vercel + provider — zasebno odobrenje)

Preduslovi: A1 kompletan, C prošao.

1. Live mapping (remote upis): `billing_provider_prices` za Starter 2990 i Pro 5990, `environment='live'`,
   `currency='RSD'`, `billing_interval='monthly'`, ID-jevi iz A1.
2. `update private.billing_runtime_config set environment = 'live';` — postojeće `test` provider-linked
   pretplate (test saloni) postaju read-only (`billing_environment_mismatch`); prihvaćeno jer nisu stvarni.
3. Vercel Production (vrednosti unosi vlasnik): `BILLING_ENVIRONMENT=live`, `BILLING_PROVIDER=lemonsqueezy`,
   `LEMONSQUEEZY_LIVE_API_KEY`, `LEMONSQUEEZY_LIVE_STORE_ID`, `LEMONSQUEEZY_LIVE_WEBHOOK_SECRET`,
   `BILLING_LIVE_WEBHOOKS_ENABLED=true`, `NEXT_PUBLIC_APP_URL`, `BILLING_LIVE_CHECKOUT_ENABLED=true`,
   `BILLING_LIVE_CHECKOUT_ALLOWED_SALON_IDS=<samo sintetički salon>` (postojeća live allowlista),
   `NEXT_PUBLIC_BILLING_CHECKOUT_ENABLED=true`; portal `BILLING_CUSTOMER_PORTAL_ENABLED=true` i
   `LEMONSQUEEZY_PORTAL_ALLOWED_HOSTS` samo ako je A1.4 potvrđeno.
   Neprisutni/isključeni: `BILLING_PLAN_CHANGE_ENABLED`, `BILLING_LIVE_RESUBSCRIBE_ENABLED`, override/pilot
   automatizacija.
4. LS live webhook → `<produkcijski URL>/api/billing/webhooks/lemonsqueezy/live`, događaji
   `subscription_created`, `subscription_updated`, `subscription_payment_success`.
5. Redeploy (zbog `NEXT_PUBLIC_*`).

Provera: `select billing_environment_matches_v1('live')` = true; acquisition salon vidi Starter/Pro; salon
van allowliste ne vidi checkout. Stani ako parity nije true ili checkout vidi salon van allowliste.

## E. Live acceptance (pravi novac — posebno eksplicitno odobrenje)

Sintetički salon i vlasnikov nalog; payment podatke unosi vlasnik. Refund se ne obećava.

1. Registracija/onboarding (trial), 1–2 aktivna zaposlena; salon je jedini u allowlisti.
2. „Izaberi Starter“ → jedan klik → LS live checkout → uplata.
3. LS: porudžbina i pretplata postoje. DB (read-only): u `billing_webhook_events` (`live`)
   `subscription_created` i `subscription_payment_success` `processed`; checkout `completed`; pretplata
   `active`, Starter, `billing_environment='live'`, kraj perioda = LS `renews_at`.
4. App: canonical prava Starter (limit 3) i jedan poslovni upis (npr. termin).
5. Portal (ako uključen): payment method vidljiv; nema promene paketa/pauze.
6. Cancel → `subscription_updated` `cancelled` processed → „Pretplata je otkazana. Pristup imate do
   <datum>“, pristup pun do kraja perioda.
7. LS: pretplata `cancelled`, `ends_at` = kraj perioda, nema zakazane naredne naplate.

Failed payment nije live potvrđen; oslanja se na lokalne testove (`past_due` → read-only, poruka, portal) i
F. Stani ako: uplata prođe, a aktivacija ne stigne za ~15 min (F4); bilo šta završi u `manual_review`.

## F. Osnovni nadzor (postojeći alati)

Supabase SQL editor (read-only) i LS dashboard (Orders, Subscriptions, Webhooks → deliveries); dnevno i na
svaku prijavu.

1. ```sql
   select environment, event_name, processing_status, error_code, count(*), max(received_at)
   from public.billing_webhook_events where processing_status in ('manual_review','received')
   group by 1,2,3,4 order by 6 desc;
   ```
2. ```sql
   select id, environment, status, created_at, expires_at from public.billing_checkout_sessions
   where status in ('creating','open') and created_at < now() - interval '1 hour';
   ```
3. Retry: `received` stariji od 15 min → ručno `POST /api/internal/billing/process-pending/live` (prazan
   POST, Bearer `BILLING_LIVE_WORKER_SECRET`, kada su `BILLING_LIVE_WORKER_ENABLED` i secret postavljeni) ili LS
   „Resend“.
4. „Platio, nemam pristup“: `docs/billing-operator-recovery-runbook.md` §5 i §12
   (`scripts/billing-recovery.mjs`: dry-run → review token → apply); `creating`:
   `docs/billing-checkout-recovery-foundation.md`. Nikad ručni `UPDATE` pretplate.
5. Ručna istraga bez apply-a: dve naplate istom kupcu, identity/ownership konflikt,
   `recovery_replacement_checkout_unresolved`, ili bilo koji ishod osim `eligible`.

Postojeći `test` ostaci (nisu blocker): 8 × `subscription_updated` `manual_review`
`processor_updated_subscription_unknown` i 2 × legacy `subscription_payment_success` `received` (0 pokušaja,
2026-07-28). Posle prelaska na `live` filtrirati po `environment='live'`.

### Retry schedule pre javnog puštanja (predlog, nije implementiran)

Ruta `process-pending/live` prima samo **prazan** POST (`400` za bilo koje telo), pa pg_cron/pg_net obrazac
iz reminder-a (`net.http_post` uvek šalje JSON telo) ne odgovara bez izmene koda. Najmanji predlog:
GitHub Actions workflow `billing-live-retry.yml` po uzoru na `billing-reconciliation-sandbox.yml`:
`workflow_dispatch` + `schedule: "*/30 * * * *"`, posao samo kada je `vars.BILLING_LIVE_RETRY_SCHEDULE_ENABLED
== 'true'` (kill switch), `permissions: {}`, `concurrency` grupa, `timeout-minutes: 2`, URL iz
`vars.BILLING_LIVE_WORKER_URL` (https, tačan host, bez redirect-a), `secrets.BILLING_LIVE_WORKER_SECRET`,
`curl -X POST` bez tela, očekivan `200`. Prvo samo ručno (dispatch) tokom E, schedule tek posle uspešnog E.
Interval 30 min drži privatni repo u okviru besplatnih GitHub minuta (~1.440 min/mes); worker ionako
poštuje backoff 1 min – 24 h. Workflow mora biti na `main` (push) i dobija zaseban live secret.

## Blocker za portal (samo ako A1.4 ne uspe)

Portal se ne uključuje. Najmanja zamena (mali kodni korak, posebno odobrenje): link „Ažuriraj način plaćanja“
iz signed `urls.update_payment_method` (postojeći adapter već čita pretplatu) i owner-only serverska akcija
„Otkaži pretplatu“ preko `DELETE /v1/subscriptions/{id}` (otkazivanje na kraju perioda) uz postojeću webhook
obradu `cancelled`. „Kontaktirajte podršku“ nije zamena za self-service cancel.

## Trial od 3 meseca — migracija 050 (izvršeno 2026-10-29)

Commit `f91cc5e` (`feat(billing): give new salons a 3-month Pro trial`). Projekat `vsfdeb…`.

1. Pre: history 70 zapisa do `202610230049`, pending samo `202610280050`; helper ne postoji; trigger
   `create_trial_subscription_for_new_salon` = stara verzija (md5 `373e7873…`).
2. Backup `C:\Users\User\rezervo-backups\20261029-2245-pre-migration-050\` (41 tabela, 22.504 reda, ACL
   samo `User`; isti obuhvat i ograničenja kao A2, nije atomski). Restore u disposable `--network none`:
   40 tabela, 0 razlika u broju redova, 0 FK prekršaja (`auth.identities` platform-managed, preskočen);
   proba 050 nad kopijom uspešna.
3. Dry-run (CLI iz kopije `supabase/` zbog BOM-a u `.env.local`): tačno `202610280050`. Primenjeno.
4. Posle: history 71, poslednji `202610280050`; helper `private.billing_internal_trial_ends_at_v1` (md5
   `6add6160…`, `stable`, `strict`, `search_path=""`, bez EXECUTE za `anon`/`authenticated`/`service_role`);
   trigger funkcija md5 `1874e530…` = lokalno, ACL nepromenjen; otisci pretplata, override-a, broj salona,
   runtime `test` i 0 otvorenih checkout-a nepromenjeni. Nijedan remote salon nije kreiran radi provere.
