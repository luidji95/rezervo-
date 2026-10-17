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
| Bilo koji drugi `manual_review` razlog (identity/ownership, mapping, plan change, same-timestamp conflict, pause, provider trial, expired reactivation, correlation/checkout) | ❌ `reason_not_allowed` | bezbednosni konflikti ostaju odbijeni |
| Događaj koji je `received`/lease-ovan | ❌ `not_manual_review` / `event_busy` | pripada retry worker-u |
| Propušten update: `past_due → active`, `active → cancelled`, `cancelled → active`, `active/cancelled → past_due`, `→ expired` | ✅ za već povezanu pretplatu | ista pravila kao `process_billing_subscription_updated_v2` (parity test) |
| Stariji snapshot od lokalnog stanja | ❌ `stale_snapshot` | |
| Isti timestamp, različit sadržaj | ❌ `same_timestamp_conflict` | |
| Promena plana, pause, provider trial, expired reactivation, nepodržano stanje | ❌ `plan_change_unsupported` / `unsupported_state` | čak i ako deo snapshot-a izgleda bezbedno |
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

## 11. Šta nije potvrđeno (kasniji remote acceptance)

- Primena migracije `202610170045` i grants na remote bazi, remote migration history.
- Stvarni Lemon Squeezy odgovor za `GET /v1/subscriptions/{id}` i `updated_at` semantika u test/live
  prodavnici; oslanjanje na `updated_at` kao ordering ključ je isto kao u webhook procesoru, ali nije
  potvrđeno protiv živog providera.
- Live: tek posle odvojene provere (kredencijali, store, jedan pregledan test-slučaj sa stvarnim
  tiketom). Kompletan lifecycle contract nije usvojen; live billing nije označen spremnim.
- Upgrade/downgrade, resubscribe posle isteka, pilot handover i bulk/automatski recovery nisu deo ove faze.
