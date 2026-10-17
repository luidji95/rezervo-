# Lemon Squeezy customer portal — B1 test/live contract

B1 podržava oba billing environment-a u kodu. Portal ostaje **default-off**:
`BILLING_CUSTOMER_PORTAL_ENABLED` mora biti tačno `true`. Implementacija ne uključuje
flag, ne menja store/deployment i ne potvrđuje spremnost kompletnog billing lifecycle-a.

## Trusted environment i autorizacija

Browser šalje prazan `POST /api/billing/customer-portal` sa Supabase Bearer sesijom.
Body i query parametri nisu dozvoljeni. Server iz verifikovane sesije pronalazi tačno
jedan salon čiji je korisnik owner i njegov subscription. Manager/employee članstvo
ne daje pristup. Browser ne bira salon, subscription/customer ID ili environment.
Nema customer-level fallback-a.

Koristi se postojeći `BILLING_ENVIRONMENT` parser i zajednički provider config resolver.
`NODE_ENV`, Vercel scope i browser nisu environment autoriteti. Pre provider poziva
service-role klijent poziva read-only `billing_environment_matches_v1` iz migracije 044.
Samo `data === true` i `error === null` prolaze. Mismatch, nedostajući RPC, nevalidan
odgovor ili exception blokiraju provider poziv. Endpoint vraća sanitizovan disabled
503; overview prikazuje `canOpenCustomerPortal=false`.

Portal ne zavisi od checkout flag-a/allowliste ili prava na poslovne izmene.
Provider-linked `active`, `cancelled` i `past_due` moraju pripadati trusted environment-u.
`past_due` owner može da popravi plaćanje i kada je salon read-only. Provider-free
trial i legacy pilot nemaju portal CTA. `trialing`, `expired`, nepotpuni identiteti
i drugi provider-i nisu podržani. Override sam ne stvara provider vezu; postojeći
validan provider-linked subscription i dalje može biti upravljan.

## Konfiguracija

| Vrednost | Test | Live |
| --- | --- | --- |
| `BILLING_ENVIRONMENT` | `test` | `live` |
| `BILLING_PROVIDER` | `lemonsqueezy` | `lemonsqueezy` |
| API key | `LEMONSQUEEZY_API_KEY` | `LEMONSQUEEZY_LIVE_API_KEY` |
| Store ID | `LEMONSQUEEZY_STORE_ID` | `LEMONSQUEEZY_LIVE_STORE_ID` |
| Flag | `BILLING_CUSTOMER_PORTAL_ENABLED`, default-off | isti flag, default-off |
| Hostovi | `LEMONSQUEEZY_PORTAL_ALLOWED_HOSTS` | ista promenljiva u live deployment scope-u |

Nema fallback-a između test/live credentials. Hostovi su tačne hostname vrednosti
odvojene zarezom, bez wildcard-a, protokola, porta ili putanje. Sve je server-only.
DB runtime se ne menja niti izlaže browseru. Nijedan environment fajl nije promenjen.

Adapter GET-om preuzima lokalno vezani Subscription i proverava resource type,
subscription ID, customer ID, konfigurisan store ID i odgovarajući `test_mode`.
Store autoritet ostaje postojeći environment-specific config; aktivan prodajni
mapping nije preduslov za payment recovery postojećeg korisnika.
HTTPS, exact host allowlist, zabrana URL credentials/fragmenta i nestandardnog porta
ostaju obavezni. Redirects se odbijaju. Vraća se providerov `urls.customer_portal`,
bez ručnog konstruisanja. URL se ne čuva niti loguje. Odgovori su `no-store`, a
greške ne sadrže provider response, signed URL, tokene ili payment podatke.

## Obavezna kasnija provider provera

Pre uključivanja operator mora u **Design → Customer Portal** potvrditi:

- plan/product/variant switching i pause/unpause su isključeni;
- payment method, billing podaci, računi/istorija i cancel/resume su dostupni;
- Back link vodi na Rezervo Settings → Plaćanje i plan;
- ista ograničenja važe i pri direktnom store `/billing` pristupu/magic-link prijavi.

App dugme ne ograničava portal akcije i provider ne sprovodi naš employee limit.
Ako se kombinacija ne može podesiti, flag ostaje isključen i release je blokiran.
Custom cancel/resume nije deo B1.

Zvanična dokumentacija proverena 2026-10-11:

- [Portal guide](https://docs.lemonsqueezy.com/guides/developer-guide/customer-portal):
  signed URL dolazi iz Subscription/Customer objekta i važi 24 sata; preporučen je
  nov URL pri kliku. Postoje globalna podešavanja i izbor dozvoljenih varijanti.
- [Portal actions](https://docs.lemonsqueezy.com/help/online-store/customer-portal):
  payment/billing, istorija i subscription akcije su provider mogućnosti.
- [Test mode](https://docs.lemonsqueezy.com/help/getting-started/test-mode):
  test podaci i API ključevi odvojeni su od live režima.

Ovo nisu dokazi konfiguracije konkretnog store-a. Dokumentacija ne potvrđuje da je
tražena kombinacija nezavisnih toggle-a raspoloživa u našem store-u; to ostaje ručni
release uslov. Provider API/store nije kontaktiran u B1.

## Lokalni acceptance

Testovi mockuju provider HTTP i DB client, bez `.env`, remote poziva i naplata:

```powershell
node --experimental-strip-types --test src/features/billing/customerPortal/*.test.ts src/features/billing/services/billingPaymentPresentation.test.ts
$billingTests = @(rg --files src/features/billing -g '*.test.ts')
node --experimental-strip-types --test @billingTests
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

Pokriveni su validan test/live tok, default-off/false, nevalidan config i credentials,
RPC mismatch/error/exception/nevalidan odgovor, owner/manager/employee/drugi tenant,
provider-free trial/pilot, read-only recovery, body/query injection, provider
identity/environment mismatch, URL validacija, sanitizacija i odsustvo provider
poziva kod lokalno odbijenih zahteva.

Overview i endpoint dele portal runtime proveru. Ako trusted `BILLING_ENVIRONMENT` nije validan, overview vraća `billingEnvironment: null` (bez 500) i UI ne tvrdi test/live dostupnost. UI koristi serverov `billingEnvironment`
samo za prikaz, nikada kao request autoritet. Presentation testovi pokrivaju test/live
tekst i nedostupnost. Kompletan browser DOM/hook E2E nije potvrđen: kasnije proveriti
klik, double-click, redirect u istom tabu, `role="alert"` i odsustvo signed URL-a u
logovima/storage-u.

## Kasniji remote/live release

Zasebnim zadatkom proveriti remote migration history i prisustvo/grants RPC-a 044,
DB/server parity, store/credentials, host i portal akcije, zatim webhook
cancel/resume/payment recovery. Završiti provider acceptance pre uključivanja flag-a.
Lokalni testovi nisu live acceptance; remote stanje nije potvrđeno niti menjano.

B1 ne menja checkout/lifecycle/entitlement procesore, interne trial datume, onboarding,
pilot override, retry ili reconciliation. Nema nove migracije, plan changes, grace,
resubscribe ili petomesečne promocije. Kompletan lifecycle contract nije usvojen.

## B2 — prikaz stanja pretplate i povratak iz portala

Prikaz koristi samo kanonične podatke iz `/api/entitlements` i `/api/billing/overview`;
komponenta ne računa novi entitlement. Logika je u čistim modulima
`billingSubscriptionPresentation.ts` i `billingStatusRefresh.ts`.

| Stanje (kanonični `accessReason`) | Prikaz | Portal |
| --- | --- | --- |
| `active_period` | „Pretplata je aktivna.“ + „Sledeća obnova: datum“ samo ako je datum validan | „Upravljaj pretplatom“ |
| `cancelled_until_period_end` | „Pretplata je otkazana. Pristup imate do datum.“ | „Upravljaj pretplatom“, bez obećanja nastavka |
| `cancelled` (posle isteka) | „Pretplata je otkazana i pristup je istekao.“ | po B1 pravilima, neutralan tekst |
| `past_due` | neuspela naplata, trenutno samo za pregled | „Ažuriraj način plaćanja“ i kad je salon read-only |
| `expired` / `period_expired` | istekla, samo za pregled, bez lažnog „nastavi“ | nema |
| `active_trial` | postojeći prikaz trial datuma i checkout tok | nema |
| override (pilot/interni…) | postojeći prikaz efektivnog pristupa; ne tvrdi se plaćena pretplata | samo ako postoji validan provider-linked subscription, bez obećanja o pristupu |

Datumi koriste `sr-Latn-RS` „long“ format u vremenskoj zoni pregledača (bez završne tačke
iz formatera). Nedostajući ili nevalidan datum se izostavlja, nikad ne izmišlja.
Portal tekst ne obećava pojedinačne akcije (cancel/resume) dok provider konfiguracija nije
potvrđena; radnja se završava kod provider-a. Nema lokalnog „Otkaži“/„Nastavi“ dugmeta.

**Zašto portal nije dostupan** — overview vraća grub razlog `portalUnavailableReason`:
`not_owner` („upravlja vlasnik salona“), `not_applicable` (trial, pilot, bez provider
veze: bez CTA) ili `unavailable` (flag isključen, nevalidan environment ili parity
neuspeh: jedna generička poruka, bez tehničkih detalja). Dok je flag isključen korisnik vidi
samo podatke o pretplati i, za provider-linked owner-a, poruku da upravljanje trenutno nije dostupno.

**Osvežavanje.** „Proveri status“ ponovo čita entitlements i overview sa servera
(meko: poslednji validni podaci ostaju ako čitanje ne uspe). Isto se jednom po 30 s
pokreće pri `visibilitychange`/`focus`/`pageshow` (bfcache) — bez pollinga i tajmera.
Povratak iz portala nije dokaz uspeha: poruke su „ažurirano“ samo ako se kanonični
podaci stvarno razlikuju, „nije promenjeno“ (uz napomenu o kašnjenju webhook-a) ili
„provera nije uspela“ (`role="alert"`). Zahtevi su single-flight; odgovori se odbacuju
nakon promene korisnika/salona, punog reload-a ili unmount-a. Browser ne zove provider i
ne čuva portal URL (otvara se samo `window.location.assign`, kao u B1).

**Lokalni acceptance** (mock-ovi, bez remote poziva):
`node --experimental-strip-types --test` nad `src/features/billing/**/*.test.ts`,
`tsc --noEmit`, `eslint src/features/billing src/app/api/billing`. Granica: u repou nema
component/browser runnera (jsdom/testing-library), pa su hookovi (`useBillingStatusRefresh`,
`refresh` u `useBillingUsage` i `EntitlementsProvider`) i JSX samo type/lint provereni;
stale-odbacivanje i cleanup nisu runtime-testirani. Ručno u browseru kasnije proveriti:
dupli klik, `Proveri status` tokom učitavanja, promenu salona usred zahteva, bfcache povratak.

**Nije potvrđeno** (remote/provider, van B2): stvarna portal konfiguracija i direktan
`/billing` pristup, webhook cancel/resume/payment-recovery protiv živog providera, remote
migracije/RPC 044. Upgrade/downgrade, resubscribe posle isteka i operatorski recovery ostaju
nepodržani; pristup posle uspešne naplate menja isključivo kanonični resolver nakon obrade događaja.

### Lokalna browser provera B1/B2 (2026-10-17)

Stvarni Billing UI i hookovi izvršeni su u Chrome-u (CDP, bez novih dependency-ja) nad
lokalnim `next dev` serverom. Sav mrežni saobraćaj presretan je pre prve navigacije:
Supabase URL je usmeren na isti origin (`/__mock_supabase`), `/api/entitlements`,
`/api/billing/overview` i `/api/billing/customer-portal` vraćaju kontrolisane odgovore
(entitlements su napravljeni stvarnim resolverima), a svaki drugi spoljni zahtev je blokiran.
Portal navigacija se servira lokalno; provider nije kontaktiran. Skripte su privremene i nisu
deo repoa. Ovo nije dokaz server autorizacije, remote baze, providera ni webhook obrade.

Nije pokriveno: promena salona unutar iste sesije (u proizvodu nema UI za to), stvarna
`/api/*` autorizacija, bfcache `pageshow` u pravom browseru (simuliran događaj), mobilni layout.
