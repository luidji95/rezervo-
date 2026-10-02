# Billing checkout recovery foundation

Ovaj dokument obuhvata tri odvojene dormant recovery faze. Pure retrieval/correlation faza nije imala migraciju, API route, secret, schedule niti provider poziv. DB claim/audit faza dodala je additive migraciju 032, audit tabelu i service-role-only RPC funkcije. Migracija 032 je potvrđeno primenjena samo na sandbox Supabase. Operator read-only faza dodaje environment-isolated interne rute i config slotove, ali su test i live capability podrazumevano isključeni i nijedna vrednost nije podešena van repozitorijuma.

## Potvrđeni Lemon Squeezy contract

Zvanično su podržani `GET /v1/checkouts/:id` i paginirani `GET /v1/checkouts`, sortiran po `created_at` opadajuće. List endpoint dokumentuje samo Store i Variant filtere, uz page number/size. Nisu dokumentovani filteri po Rezervo checkout-session UUID-u, idempotency key-u, order ID-u, subscription ID-u ili creation-time prozoru. Checkout nema dokumentovanu direktnu order/subscription relationship.

Retrieve-by-ID je zato dozvoljen samo kada je provider checkout ID već poznat. List recovery mora pregledati stranice; zero rezultata na jednoj stranici nije definitivni `not_found`. Kada bezbedni maksimalni page limit prekine pretragu, rezultat je `pagination_limit_reached`, ne provider-not-found. Pretraga sme ranije završiti tek kada newest-first rezultati postanu stariji od recovery prozora.

## Korelacijski autoritet

Provider `checkout_data.custom.checkout_session_id` je obavezan signal za exact match, ali nije samostalan autoritet. Exact correlation zahteva i trusted environment/test mode, Store, Variant, lokalni creation window i odsustvo konflikta sa već poznatim provider checkout ID-em. Interni recovery prozor je pet minuta pre lokalnog `created_at` radi tolerancije sata i 35 minuta posle njega radi pokrivanja postojećeg 30-minutnog checkout pokušaja; to nije provider filter niti dokaz samo po sebi. Ako custom salon, plan ili idempotency vrednosti postoje, moraju odgovarati lokalnom ledgeru; one su samo corroborating podaci.

Nula potpuno potvrđenih kandidata nakon iscrpljene pretrage daje `search_exhausted_not_found`. Više potvrđenih kandidata daje `ambiguous`. Kandidat sa odgovarajućim checkout-session UUID-em, ali pogrešnim environmentom, Store-om, Variant-om ili corroborating podacima daje `invalid_candidate`. Ambiguous i invalid slučajevi zahtevaju manual review; nikada se ne bira prvi rezultat.

## DB claim i audit foundation

Samo `creating` ledger može dobiti aktivan recovery attempt; baza izdaje random claim token, ograničeni lease i rastući attempt number. Partial unique indeks i zaključavanje checkout reda obezbeđuju najviše jedan aktivan claim po checkoutu i environmentu. Istekli claim se prvo označava kao `abandoned`, pa tek onda može nastati novi attempt; stari token ne može završiti novi attempt.

Claim RPC vraća samo minimalne trusted ledger činjenice. `open` i `completed` ledgeri vraćaju read-only terminalni rezultat bez recovery attempta, dok `failed`, `expired` i `cancelled` ostaju terminalni/manual-review slučajevi. Complete RPC završava samo sanitizovani audit attempt i ne menja checkout ili subscription stanje.

## Operator-only read-only servis

Postoje environment-isolated interne rute:

- `POST /api/internal/billing/recover-checkout/test`;
- `POST /api/internal/billing/recover-checkout/live`.

Obe su disabled po defaultu, imaju odvojene Bearer secret slotove i provider credentials bez fallbacka. Trusted environment dolazi iz route literala i mora odgovarati deployment `BILLING_ENVIRONMENT`. Request prihvata samo interni checkout-session UUID; salon, plan, Store, Variant i idempotency dolaze iz claim RPC-a i lokalnog environment-scoped mappinga.

Provider lookup se obavlja izvan DB transakcije. Poznati provider checkout ID koristi samo retrieve-by-ID. Kada ID ne postoji, bounded list pretraga koristi samo dokumentovane Store/Variant filtere i nikada ne bira prvi rezultat. Exact provider match trenutno daje audit outcome `still_pending`; ne menja ledger.

Servis ne vraća checkout URL, provider ID, salon ID, plan ID, idempotency key, claim token, raw response ili PII. Nema schedule-a, automatskog retry loop-a ni legacy route aliasa. Live ostaje dormant.

HTTP `success` označava poslovno pozitivan read-only rezultat samo za `already_open`, `already_completed` i `still_pending`. Auditovani rezultati poput `provider_not_found`, `invalid_candidate`, `ambiguous`, `pagination_limit_reached`, `manual_review` i `invalid_provider_response` koriste HTTP 200 uz `success: false`. Neočekivane repository ili programske greške ne upisuju se kao `configuration_error`; endpoint ih sanitizuje kao HTTP-only `internal_error` sa statusom 500. `internal_error` nije DB audit outcome.

## Granice

Ove faze ne menjaju `billing_checkout_sessions`, ne pozivaju `markOpen`, ne kreiraju checkout i ne menjaju `subscriptions`. Token-authoritative `creating → open` finalizacija još nije implementirana. Pravi live checkout ostaje isključen.
