# Billing checkout recovery foundation

Ovaj dokument opisuje pure/dormant checkout retrieval i correlation foundation. Faza nema API route, DB mutation, migraciju, secret, schedule niti provider poziv tokom implementacije. Live ostaje dormant, a pravi checkout nije uključen.

## Potvrđeni Lemon Squeezy contract

Zvanično su podržani `GET /v1/checkouts/:id` i paginirani `GET /v1/checkouts`, sortiran po `created_at` opadajuće. List endpoint dokumentuje samo Store i Variant filtere, uz page number/size. Nisu dokumentovani filteri po Rezervo checkout-session UUID-u, idempotency key-u, order ID-u, subscription ID-u ili creation-time prozoru. Checkout nema dokumentovanu direktnu order/subscription relationship.

Retrieve-by-ID je zato dozvoljen samo kada je provider checkout ID već poznat. List recovery mora pregledati stranice; zero rezultata na jednoj stranici nije definitivni `not_found`. Kada bezbedni maksimalni page limit prekine pretragu, rezultat je `pagination_limit_reached`, ne provider-not-found. Pretraga sme ranije završiti tek kada newest-first rezultati postanu stariji od recovery prozora.

## Korelacijski autoritet

Provider `checkout_data.custom.checkout_session_id` je obavezan signal za exact match, ali nije samostalan autoritet. Exact correlation zahteva i trusted environment/test mode, Store, Variant, lokalni creation window i odsustvo konflikta sa već poznatim provider checkout ID-em. Interni recovery prozor je pet minuta pre lokalnog `created_at` radi tolerancije sata i 35 minuta posle njega radi pokrivanja postojećeg 30-minutnog checkout pokušaja; to nije provider filter niti dokaz samo po sebi. Ako custom salon, plan ili idempotency vrednosti postoje, moraju odgovarati lokalnom ledgeru; one su samo corroborating podaci.

Nula potpuno potvrđenih kandidata nakon iscrpljene pretrage daje `search_exhausted_not_found`. Više potvrđenih kandidata daje `ambiguous`. Kandidat sa odgovarajućim checkout-session UUID-em, ali pogrešnim environmentom, Store-om, Variant-om ili corroborating podacima daje `invalid_candidate`. Ambiguous i invalid slučajevi zahtevaju budući manual review; nikada se ne bira prvi rezultat.

## Data minimization i granice faze

Normalizer zadržava samo provider checkout/Store/Variant identitet, četiri opcionalna custom korelacijska polja, test mode, HTTPS checkout URL, expiry i provider creation/update vreme. Ne zadržava raw JSON, checkout data, email, ime, adresu ili poreske podatke. Greške su stabilne i ne sadrže provider response ili tajne.

Ova faza ne menja `billing_checkout_sessions`, ne poziva `markOpen`, ne kreira checkout i ne pokušava subscription recovery. Sledeća zasebno odobrena faza može dodati manual-only operator claim/audit i read-only provider retrieval, pa tek zatim token-authoritative `creating → open` finalizaciju.
