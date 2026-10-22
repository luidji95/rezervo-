# Operatorski billing recovery (faza D) — runbook

Minimalan, ručno pokretan postupak za slučaj kada je provider potvrdio pretplatu ili
naplatu, a Rezervo nije ažurirao stanje. Jedan cilj po pozivu, **dry-run je podrazumevan**,
primena je eksplicitna i auditovana (uz ograničenja iz odeljka 10). Ovo nije admin sistem, nema HTTP endpoint ni UI.

> Status provere: kod, migracija `202610170045` i testovi su proveravani **samo lokalno**
> (disposable PostgreSQL, mockovan provider). Migracija nije primenjena na remote bazi, provider
> nije kontaktiran, a live billing nije potvrđen. Vidi odeljak 11.

## 1. Koji mehanizam kada

| Situacija | Mehanizam | Ko ga pokreće |
| --- | --- | --- |
| Događaj je primljen, ostao `received`, privremena greška ili zavisnost | **Retry worker** (`POST /api/internal/billing/process-pending/{test|live}`) | automatski |
| Događaj je u `manual_review` zbog redosleda/nedostupnosti (usko ograničena lista), a preduslov je sada ispunjen | **Reprocess** (`billing-recovery event`) | operator |
| Pretplata je povezana, a promena stanja kod providera nikada nije stigla (ili je stigla pogrešnim redosledom) | **Snapshot recovery** (`billing-recovery subscription`) | operator |
| Checkout je završen, a lokalni checkout/pretplata nije finalizovan | postojeći **checkout recovery** (`POST /api/internal/billing/recover-checkout/{test|live}`, token-authoritative finalizer) | postojeći tok |
| Samo utvrđivanje odstupanja | **Reconciliation** (`/api/internal/billing/reconcile-linked-subscriptions`, read-only, ne primenjuje ništa) | worker |

Reconciliation ostaje read-only. Recovery nikada ne primenjuje promene automatski.

## 2. Preduslovi

- Migracija `202610170045_operator_billing_recovery.sql` primenjena na ciljnu bazu (remote: tek posle
  odvojenog, pregledanog rollout-a) i `private.billing_runtime_config` ima red za to okruženje.
- U operatorovoj shell sesiji (ne u argumentima komande):
  `BILLING_OPERATOR_RECOVERY_ENABLED=true` (opt-in, podrazumevano isključeno), `BILLING_ENVIRONMENT`
  (`test` ili `live`), `BILLING_PROVIDER=lemonsqueezy`, API ključ i store ID tog okruženja
  (`LEMONSQUEEZY_API_KEY`/`LEMONSQUEEZY_STORE_ID` za test, `LEMONSQUEEZY_LIVE_API_KEY`/
  `LEMONSQUEEZY_LIVE_STORE_ID` za live — nema fallback-a između njih), `NEXT_PUBLIC_SUPABASE_URL`
  (ili `SUPABASE_URL`) i `SUPABASE_SERVICE_ROLE_KEY`.
- Komanda ne prima ključeve ni okruženje kroz argumente i ne ispisuje ih. Okruženje se izvodi samo iz
  `BILLING_ENVIRONMENT`; baza dodatno potvrđuje parity kroz `billing_environment_matches_v1`.
- Ne pokreći iz CI-ja ni sa deljene mašine. Ne unosi ručni SQL `UPDATE` — to nije podržan recovery.

## 3. Tok: dry-run → pregled → apply → verifikacija

```powershell
# 1) Dry-run (podrazumevano, ništa se ne menja)
npm run billing:recovery -- subscription --subscription <subscription-uuid>
npm run billing:recovery -- event --event <webhook-event-uuid>

# 2) Pregledaj izlaz: okruženje, cilj, trenutno stanje, predlog, poreklo dokaza, "Review token"

# 3) Apply — sa tokenom iz dry-run-a, referencom tiketa i razlogom
npm run billing:recovery -- subscription --subscription <subscription-uuid> --apply `
  --review-token <token-iz-dry-run-a> --ticket OPS-123 `
  --reason "Provider potvrdio nastavak pretplate, webhook nikada nije stigao" --operator ime.prezime

# 4) Verifikuj (odeljak 6)
```

- **Review token** vezuje apply za tačno ono što si pregledao: lokalno stanje, provider dokaz i predlog.
  Ako se bilo šta promenilo (webhook, drugi operator, novi provider snapshot), ishod je `stale` i
  **moraš ponoviti dry-run i ponovo pregledati**.
- Za `subscription` komandu provider snapshot se čita pri dry-run-u i ponovo pri apply-u; DB poziv
  se radi tek posle toga (transakcija nikada nije otvorena tokom HTTP poziva providera).
- `--reason` i `--ticket` se trajno čuvaju u auditu: ne upisuj lične podatke klijenata, URL-ove ni tajne.
- Snapshot apply ažurira `provider_state_updated_at` (ključ redosleda, isti kao kod webhook-a), a `provider_last_webhook_event_id` ostaje nepromenjen jer snapshot nije webhook događaj.
- `--operator` je slobodna oznaka i **nije dokaz identiteta**; audit uz nju čuva i DB servisnu ulogu (ni ona nije identitet osobe).

## 4. Matrica podrške

| Slučaj | Podrška | Napomena |
| --- | --- | --- |
| Reprocess `subscription_updated` u `manual_review` sa `processor_updated_subscription_unknown` | ✅ kada lokalna pretplata sada postoji | koristi postojeći `process_billing_subscription_updated_v2` |
| Reprocess `subscription_updated` ili `subscription_created` sa `processor_retry_exhausted` | ✅ (updated: lokalna pretplata mora postojati) | procesor ponovo sve proverava |
| Reprocess `subscription_created` sa `processor_checkout_capacity_exceeded` / `processor_checkout_state_invalid` | ✅ samo uz preduslove iz odeljka 12 | zamena (replacement) uvek ostaje ručna istraga |
| Bilo koji drugi `manual_review` razlog (identity/ownership, mapping, plan change, same-timestamp conflict, pause, provider trial, expired reactivation, checkout correlation) | ❌ `reason_not_allowed` | bezbednosni konflikti ostaju odbijeni |
| Događaj koji je `received`/lease-ovan | ❌ `not_manual_review` / `event_busy` | pripada retry worker-u |
| Propušten update: `past_due → active`, `active → cancelled`, `cancelled → active`, `active/cancelled → past_due`, `→ expired` | ✅ za već povezanu pretplatu | ista pravila kao `process_billing_subscription_updated_v2` (parity test) |
| Stariji snapshot od lokalnog stanja | ❌ `stale_snapshot` | |
| Isti timestamp, različit sadržaj | ❌ `same_timestamp_conflict` | |
| Promena plana, pause, provider trial, expired reactivation, nepodržano stanje | ❌ `plan_change_unsupported` / `unsupported_state` | čak i ako deo snapshot-a izgleda bezbedno |
| C2: snapshot dok postoji nerazrešena promena plana (`billing_subscription_plan_changes`) | ✅ samo kao lifecycle opažanje | target varijanta je očekivana, period se ograničava na `baseline_period_end`, plan se ne menja; završetak isključivo kroz zajednički evaluator uz plaćen `renewal` invoice (E3). Snapshot nikad sam ne dodeljuje target ni novi period. Neočekivana varijanta → promena u `manual_review`. |
| Pogrešan tenant/customer/store/subscription ID, `test_mode`, okruženje | ❌ `identity_conflict` / `mapping_conflict` | |
| Plaćen invoice bez povezane pretplate / bez potvrđenog stanja | ❌ ne aktivira ništa | vidi odeljak 5 |
| Kreiranje pretplate iz snapshot-a ili invoice-a | ❌ nije podržano | samo postojeći created/checkout tok |
| Bulk, scheduler, automatski healing | ❌ | |

Šta recovery **ne radi**: ne menja plan, ne menja `current_period_starts_at`, ne rekonstruiše
renewal kalendar, ne dira SMS quota, entitlement ni override, ne pretvara snapshot u webhook
događaj (u `billing_webhook_events` se ništa ne upisuje), ne vraća istekle pretplate.

## 5. Korisnik je platio, ali nema aktivacije

1. Nađi `billing_webhook_events` red za `subscription_created` (po checkout-u/ID-ju) i njegov `processing_status`/`error_code`.
2. `received` → sačekaj retry worker; ne diraj.
3. `manual_review` + `processor_retry_exhausted` → `billing-recovery event` dry-run → apply.
4. `manual_review` + bilo koji drugi razlog (correlation, ownership, mapping, `processor_provider_state_unsupported`
   npr. istekao `renews_at`) → **stani**. Nema bezbednog dokaza za aktivaciju: eskaliraj uz tiket, proveri
   checkout ledger i postojeći **checkout recovery**. Ne kreiraj pretplatu iz invoice-a ili provider ID-ja.
5. Nema nijednog događaja → događaj nikada nije primljen: retry ne može da ga oporavi. Ako lokalna pretplata
   **već postoji i povezana je**, koristi `subscription` snapshot recovery. Ako ne postoji — nepodržano,
   ručna istraga (checkout recovery ili podrška providera), ne SQL.
6. `subscription_payment_success` invoice evidence sam po sebi **ne menja prava**; potreban je validan
   subscription događaj/snapshot koji prolazi identity, environment, mapping i lifecycle provere.

## 6. Verifikacija posle apply-a

- Ishod u izlazu: `applied` / `reprocessed` (uspeh), `no_change` (već primenjeno, bezbedno ponavljanje),
  `dependency_pending` (događaj ostaje `received`, preuzima ga retry worker).
- Audit (read-only SQL, service role): `select recovery_kind, environment, outcome, error_code, ticket_ref,
  operator_label, database_role, created_at, prior_state, applied_state from public.billing_recovery_attempts
  where subscription_id = '<uuid>' or webhook_event_id = '<uuid>' order by created_at desc;`
  Audit je append-only; ne sadrži payload-e, URL-ove ni tajne.
- Canonical pristup: proveri `GET /api/entitlements?salonId=…` kao owner (ili `resolve_salon_access_v1`) —
  `accessReason`, `accessMode`, `accessEndsAt`. Pristup određuje isključivo canonical resolver:
  aktivan **override ima prioritet** i može davati full access nezavisno od ishoda recovery-ja
  (i obrnuto: recovery `active` ne vraća prava ako resolver kaže drugačije). Overview/UI prikazuje
  stanje naplate i efektivni pristup odvojeno.

## 7. Ishodi i kada se staje

| Ishod | Značenje | Akcija |
| --- | --- | --- |
| `stale` | stanje ili dokaz promenjeni od dry-run-a | ponovi dry-run, novi pregled |
| `reason_not_allowed`, `identity_conflict`, `mapping_conflict`, `plan_change_unsupported`, `unsupported_state`, `same_timestamp_conflict`, `stale_snapshot` | bezbednosno odbijanje | **stani**, eskaliraj; ne zaobilazi |
| `precondition_unmet` | preduslov nije ispunjen (npr. nema lokalne pretplate) | reši preduslov kroz postojeći tok |
| `event_busy`, `not_manual_review` | događaj pripada retry worker-u | sačekaj |
| `environment_mismatch` | baza i `BILLING_ENVIRONMENT` se ne poklapaju | **stani**, proveri okruženje shell-a |
| `not_found` | cilj ne postoji u tom okruženju | proveri UUID i okruženje |
| `operational_failure` (exit 3) | provider/baza nedostupni, sanitizovano | ponovi kasnije; ništa nije primenjeno |

Exit kodovi: `0` uspeh/nema akcije, `1` upotreba/konfiguracija, `2` odbijeno ili potreban novi pregled, `3` operativna greška.

## 8. Test i live

- Isti kod i ista pravila za oba okruženja; okruženje je isključivo trusted `BILLING_ENVIRONMENT`
  operatorove shell sesije plus DB parity. Evidence mora imati odgovarajući `test_mode` i store ID.
- Live zahteva eksplicitni opt-in i live ključeve; test podaci se ne primenjuju na live i obrnuto.

## 9. Lokalne provere (izvršene)

`npm run test:billing-recovery` (parsiranje, config, orkestracija, sanitizacija, mock provider),
`npm run test:billing-recovery-db` (SQL contract + TS sloj nad stvarnim RPC-ovima, disposable PostgreSQL),
`npm run test:billing-recovery-concurrency` (paralelni operatori, operator naspram webhook-a i retry worker-a).
DB testovi koriste isključivo disposable kontejner iz `scripts/lib/disposable-supabase-postgres.mjs`.

## 10. Bezbednosni contract (šta garantuje, a šta ne)

**Review token** nije tajna i nije potpisan; svaki put se ponovo izračunava u bazi iz autoritativnih podataka:
SHA-256 nad lokalnim stanjem pretplate (plan, status, period, cancel flag, `cancelled_at`,
`provider_state_updated_at`, identitet), otiskom provider dokaza (svih polja snapshot-a), verdiktom i predloženom
promenom (za event reprocess: stanje događaja i lokalne pretplate). Token **nije autoritet**: ne zamenjuje identity,
environment, mapping i lifecycle validaciju — one se uvek izvršavaju iznova. Token samo garantuje da se apply odnosi
na tačno ono što je operator pregledao.

**Apply**, redom, u jednoj DB transakciji: unos (ticket/razlog/oznaka) → DB parity okruženja → `FOR UPDATE` na
pretplati (isti lock koji uzima webhook procesor; redosled subscription → plan → mapping, kao u
`process_billing_subscription_updated_v2`) → ponovna evaluacija iz parametara → poređenje tokena → upis. Provera i
upis su pod istim lockom, pa nema TOCTOU prozora; konkurentni webhook ili drugi operator se serijalizuju, a apply
koji izgubi trku dobija `stale` / `stale_snapshot` i ne menja ništa. `no_change` (stanje već odgovara dokazu) ne zavisi
od tokena i ne menja ništa. Za event reprocess lock je na `billing_webhook_events` (zatim facts i pretplata u procesoru).

**Poreklo dokaza.** Snapshot se dobija isključivo trusted provider adapterom (`GET /v1/subscriptions/{id}` sa
ključem tog okruženja), normalizuje se i proverava (ID pretplate, store, `test_mode`) pre RPC poziva. CLI nema
argument za snapshot/JSON, a prosleđen token ne može da uvede dokaz. RPC-ovi su dostupni samo `service_role`
(SECURITY DEFINER, `search_path=''`, bez `anon`/`authenticated`/`PUBLIC`); service role je poverljiv server i
RPC ne može da razlikuje „pravi“ snapshot od proizvoljnih parametara — zato su kredencijali operatorova odgovornost.
Za reprocess jedini dokaz je postojeći durable događaj. Provider HTTP poziv se obavlja pre RPC-a; nijedna DB
transakcija nije otvorena tokom njega. DB parity se proverava na početku transakcije (promena `billing_runtime_config`
usred poziva nije scenario ovog toka).

**Audit** (`billing_recovery_attempts`) je append-only (trigger blokira UPDATE/DELETE; nijedna izložena uloga nema
INSERT/UPDATE/DELETE, `service_role` samo SELECT; upisuju ga samo RPC-ovi). Beleži se svaki apply koji je stigao do
evaluacije cilja, uključujući odbijene (`stale`, `reason_not_allowed`, `identity_conflict`, …) i `no_change`.
**Ne beleži se:** neispravan unos (greška 22023), `environment_mismatch`, `not_found` — nema pouzdanog cilja/okruženja.
Ako procesor ili upis baci izuzetak, **cela transakcija se vraća**: nema delimične promene, ali ni audit reda — greška
se vidi kao `operational_failure`. Dry-run se ne audituje i ne menja ništa. Ovo nije zamena za zaseban logging.
**Identitet:** `operator_label` je slobodan unos, a `database_role` je DB servisna uloga — nijedno nije dokaz
identiteta fizičke osobe. Ticket je jedina veza sa odgovornim licem.

**Napomena o reprocess-u:** `processor_retry_exhausted` samo dozvoljava ponovni pokušaj; procesor ponovo izvršava
sve provere i može ponovo da odbije. Brojač pokušaja se uvećava; ako je događaj ostao `received` zbog
`dependency_pending` posle ≥7 pokušaja, sledeći worker pokušaj ga ponovo šalje u `manual_review`.

### Obaveza održavanja (parity)

Snapshot recovery (`private.evaluate_billing_snapshot_recovery_v1`) namerno ponavlja pravila
`process_billing_subscription_updated_v2`, bez refaktorisanja lifecycle-a. **Svaka buduća izmena updated procesora
(uključujući novu verziju) mora da proveri snapshot recovery put i proširi parity test**
(`supabase/tests/billing_operator_recovery_contract.sql`, odeljak „parity“, uključujući poređenje konačnog stanja i
canonical pristupa kroz `resolve_salon_access_v1`). Nova stanja/razlozi se dodaju u `pg_temp.expected_recovery`.
Bez toga recovery put ne sme da ostane omogućen.

C2 (`202610190047`) je izmenio updated procesor i snapshot evaluaciju na isti način (očekivana
target varijanta, ograničen period, zajednički evaluator). Parity za tranzicije je u
`supabase/tests/billing_c2_plan_change_contract.sql` (odeljak 8: isti salon kroz webhook i kroz
snapshot daje isti status promene, isto stanje pretplate i isti canonical pristup). Review token
sada pokriva i stanje nerazrešene promene. Promena u `manual_review` nema apply alat u ovoj fazi
i ostaje blokirajuća (read-only posle baseline-a) do eksplicitnog razrešenja.

## 11. Šta nije potvrđeno (kasniji remote acceptance)

- Primena migracije `202610170045` i grants na remote bazi, remote migration history.
- Stvarni Lemon Squeezy odgovor za `GET /v1/subscriptions/{id}` i `updated_at` semantika u test/live
  prodavnici; oslanjanje na `updated_at` kao ordering ključ je isto kao u webhook procesoru, ali nije
  potvrđeno protiv živog providera.
- Live: tek posle odvojene provere (kredencijali, store, jedan pregledan test-slučaj sa stvarnim
  tiketom). Kompletan lifecycle contract nije usvojen; live billing nije označen spremnim.
- Resubscribe posle isteka, pilot handover i bulk/automatski recovery nisu deo ove faze.
  Upgrade/downgrade od sledeće obnove ima samo lokalnu DB osnovu (default-off), vidi
  `docs/billing-plan-change-next-renewal.md`.

## 12. C1: kupovina koja čeka aktivaciju (`subscription_created`)

Migracija `202610180046` proširuje `event` reprocess za tačno dva razloga created događaja.
Alat i tok su isti (dry-run → review token → apply → audit); procesor ostaje jedini koji aktivira.

| Razlog | Preduslov checkout-a | Kada je `eligible` |
| --- | --- | --- |
| `processor_checkout_capacity_exceeded` | isti checkout je i dalje `open` | owner je smanjio broj aktivnih zaposlenih na ciljni limit |
| `processor_checkout_state_invalid` | isti checkout je `expired` | nema nikakve kasnije zamene (vidi dole) |

Zajednički obavezni preduslovi: originalni potpisani created događaj sa facts v2 i
`correlation_status='ready'`; checkout korelacija (salon, idempotency key, okruženje); pretplata
salona je **provider-free** (nijedna druga provider pretplata se ne prepisuje); nema drugog
`completed` checkout-a; nema drugog neobrađenog created događaja za salon; ciljni plan Starter/Pro;
aktivni zaposleni ≤ ciljni limit; `renews_at` iz događaja je u budućnosti. Apply uzima lockove
procesora unapred (event → facts → checkout-i salona → plan → pretplata → capacity) i ponovo
proverava review token pod njima.

**Rollback.** Za `expired` checkout apply ga privremeno vraća u `open` **samo unutar
podtransakcije** i poziva postojeći created procesor. Svaki ishod osim `processed` vraća
podtransakciju: checkout ostaje `expired`, događaj ostaje u `manual_review` sa izvornim razlogom,
pretplata se ne menja; audit beleži `activation_rejected`, procesorski kod i `rolled_back: true`.
Izuzetak (npr. greška baze) vraća celu transakciju bez audit reda.

**Zamena (replacement) — uvek ručna istraga.** Ako za isti salon postoji checkout kreiran posle
ciljnog u statusu `creating`, `open` ili `expired`, ishod je `precondition_unmet` /
`recovery_replacement_checkout_unresolved`. Istek URL-a zamene i to što njen created događaj nije
stigao **nisu dokaz** da zamena nije plaćena; čekanje ne razrešava konflikt i alat ga ne oslobađa.
Operator mora van sistema proveriti kod providera (dashboard, bez write operacija iz Rezervo-a):
da li postoji porudžbina/pretplata za checkout zamene, da li postoje dve naplate istom kupcu i
kojoj pretplati kupac treba da pripada. Razrešenje (npr. refundacija ili otkazivanje kod providera)
je izvan ovog alata; posle toga, ako stigne created događaj zamene, on se obrađuje normalno, a stari
ostaje u `manual_review`. Za takve salone nova kupovina ostaje blokirana dok aktivacija čeka.

**Nepodržano (operatorska istraga):** created događaj za `failed`/`creating`/`cancelled` checkout
(`recovery_checkout_state_unsupported`); prošao `renews_at` (`recovery_provider_period_elapsed`);
povezana pretplata (`recovery_subscription_already_linked`); događaj koji nikada nije stigao;
korelacioni, mapping i ownership konflikti (`reason_not_allowed`). Za ove slučajeve ne postoji
automatski ni operatorski apply; salon ostaje blokiran za novu kupovinu dok je događaj neobrađen.

**Tok za „plaćeno, ali previše zaposlenih“:** owner vidi poruku i deaktivira višak (deaktivacija
radi i kad je pristup read-only) → `billing-recovery event --event <id>` dry-run → `eligible` →
apply sa tiketom → proveri `/api/entitlements` (`purchaseActivation` nestaje, plan je Starter).


## 13. C2: nerazrešena promena paketa (`plan-change`)

Migracija `202610220048` dodaje komandu `plan-change --change <plan-change-uuid>`. Tok je isti kao
kod D: dry-run (validiran provider GET van DB transakcije) → pregled → apply sa review tokenom,
tiketom, razlogom i operator labelom → audit u `billing_recovery_attempts` (`recovery_kind =
plan_change`). Ne postoji javni endpoint, bulk, scheduler ni automatski healing. Operator label je
slobodan tekst, a service credentials nisu identitet fizičke osobe. Alat **nikad** ne šalje PATCH,
ne vraća plan kod providera, ne završava promenu i ne dodeljuje novi paket ni period bez dokaza.

Kada se koristi: UI prikazuje „Ishod promene još nije potvrđen…“ (`requested`/`unknown`) ili
„Promenu je potrebno proveriti. Obratite se podršci.“ (`manual_review`). ID promene se dobija iz
service-role čitanja `billing_subscription_plan_changes` za salon (bez ručnih UPDATE-a).

```
node --experimental-strip-types scripts/billing-recovery.mjs plan-change --change <uuid>
# pregledati Verdict / Code / Proposed / Plan change / Evidence
node --experimental-strip-types scripts/billing-recovery.mjs plan-change --change <uuid> \
  --apply --review-token <token iz dry-run-a> --ticket OPS-123 --reason "<zašto>" --operator <label>
```

### Podržane akcije (samo ove dve)

| Akcija | Kada je ponuđena | Šta radi |
| --- | --- | --- |
| `record_observed` | `requested` ili `unknown`; svež provider snapshot pokazuje target varijantu, `renews_at` = baseline, a provider `updated_at` je posle pre-request čitanja i pre baseline-a (postojeći E1 contract, bez izuzetaka) | beleži snapshot kao dokaz i poziva zajednički evaluator → `confirmed`. Paket i period se **ne** menjaju; i dalje su potrebni E2 (lifecycle) i E3 (plaćen renewal invoice). |
| `resolve_not_applied` | `requested`, `unknown` ili `manual_review` sa razlogom `plan_change_renewed_on_previous_plan`; target **nikad** nije viđen; primenjeni lifecycle pokazuje obnovu na **staroj** varijanti posle baseline-a (u granici jednog meseca + 4 dana); postoji plaćen `renewal` invoice za taj period (ista pretplata/kupac/store/okruženje, posle baseline-a, neiskorišćen); svež provider GET i dalje pokazuje staru varijantu | promena → `not_applied`, a granica pristupa se podiže na već plaćeni period **starog** paketa. Invoice se upisuje u `renewal_invoice_id` reda promene, iste kolone kao completion invoice, pa ga postojeći unique indeks čini isključivim (ne može razrešiti drugu promenu ni završiti drugu). Rezervacija kapaciteta se oslobađa tek tada. |

Dupli apply nema efekat (`precondition_unmet` / `no_change`). Promena stanja između dry-run-a i
apply-a (promena, pretplata, dokaz, invoice ili broj aktivnih zaposlenih) daje `stale` — ponoviti
dry-run. Apply ponovo procenjuje sve pod lockom pretplate i reda promene.

**Audit — stvarna garancija.** Audit red (`recovery_kind = plan_change`) nastaje za svaki apply koji
stigne do procene: `recorded`, `resolved_not_applied`, `stale`, `unsupported`, `precondition_unmet`,
`identity_conflict`, `conflict`, `unsupported_state` i ponovljeni apply (`no_change` /
`precondition_unmet`). Audit reda **nema** za: nevalidan unos (ticket, razlog, operator label, token,
okruženje — odbija se izuzetkom pre procene; CLI ga odbija i pre poziva), nepostojeću promenu
(`not_found`) i environment mismatch. Izuzetak tokom apply-a (npr. procesor/evaluator ili constraint)
poništava celu transakciju zajedno sa audit redom; CLI tada prijavljuje `operational_failure`.
Podtransakcija u ovom alatu ne postoji. Operator label je slobodan tekst, a service-role kredencijal
je granica poverenja; audit ne dokazuje identitet osobe.

**Kasni dokaz posle `not_applied`.** Zakasneli ili noviji target `subscription_updated` posle
razrešenja daje `processor_updated_plan_change_unsupported` (događaj u `manual_review`), D snapshot sa
target varijantom daje `plan_change_unsupported`, a dodatni invoice nema efekat: promena se ne
otvara ponovo, ne završava retroaktivno, i plaćeni period starog paketa ostaje. Ako u međuvremenu
postoji nova promena, stari target dokaz stariji od njenog pre-request čitanja označava novu promenu
kao `manual_review` (`plan_change_evidence_order_conflict`), uz zadržan plaćeni pristup.

### Primeri

**`requested` posle prekida procesa (ili `unknown` posle nejasnog PATCH-a).** Dry-run:
- provider pokazuje target pre granice → `eligible` / `record_observed` → apply → `confirmed`.
  Ako nedostaje obnova, posle `renews_at` koristiti `subscription` komandu (odeljak 4) za propušten
  update; plaćen invoice stiže webhook-om. Tek tada evaluator završava promenu.
- provider pokazuje **staru** varijantu pre obnove → `recovery_plan_change_dispatch_unresolved`.
  **Stati.** Čitanje sa starom varijantom ne dokazuje ni da PATCH nije poslat ni da neće biti
  primenjen. Sačekati obnovu: ako se obnovi na staroj varijanti i stigne plaćen renewal invoice,
  dry-run nudi `resolve_not_applied`.
- provider pokazuje target tek posle granice → `recovery_plan_change_pre_boundary_evidence_missing`.
  **Stati.** Jedini poznati dodatni dokaz: ponovo poslati (resend) originalni `subscription_updated`
  webhook iz Lemon Squeezy dashboarda; potpisana isporuka sa originalnim `updated_at` pre granice
  automatski potvrđuje E1 (i kad je zakasnela). Bez toga nema razrešenja.

**`manual_review`, obnova na prethodnom paketu bez plaćanja.** Dry-run vraća
`recovery_plan_change_payment_evidence_missing`. **Stati.** Proveriti u provider dashboardu da li je
renewal plaćen; ako jeste, ponovo poslati `subscription_payment_success` webhook (resend) da invoice
uđe u evidenciju, pa ponoviti dry-run. Bez plaćenog invoice-a alat ne daje novi period.

**`confirmed`, ali nema završetka.** `recovery_plan_change_lifecycle_evidence_missing` → propušten
lifecycle update kroz `subscription` komandu (cap i payment gate ostaju). Zatim
`recovery_plan_change_payment_evidence_missing` → invoice webhook resend. Alat ne nudi akciju.

**E1 sa istim timestamp-om** (`plan_change_evidence_order_conflict`). Dry-run vraća
`recovery_plan_change_e1_order_unprovable`. **Nije podržano i neće biti forsirano**: provider
`updated_at` ima preciznost od sekunde, pa redosled u odnosu na pre-request čitanje nije dokaziv;
operatorovo uverenje nije dokaz. Promena ostaje blokirajuća, a pristup posle baseline-a ostaje
read-only. Nastavak zahteva novi autoritativni dokaz koji ne postoji u trenutnim izvorima (npr.
provider zapis o vremenu promene sa većom preciznošću); do tada je ovo poslovna odluka van alata.

**Ostali konflikti** (`plan_change_variant_unexpected`, `plan_change_variant_reverted`,
`plan_change_renewal_period_unexpected`, identity/store konflikti) →
`recovery_plan_change_conflict_unsupported` ili `identity_conflict`. Ručna istraga kod providera;
nema apply-a.

### Šta nije podržano

Force complete, force reject, zanemarivanje timestamp-a, ponovni PATCH, provider rollback,
refundacija, razrešenje bez plaćenog invoice-a, oslobađanje rezervacije bez razrešenja i ručni SQL
UPDATE. Opisi istrage iznad nisu implementirano razrešenje.
