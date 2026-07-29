# Lemon Squeezy sandbox customer portal

Customer portal je server-side, fail-closed sandbox integracija. Browser šalje prazan `POST /api/billing/customer-portal` sa Supabase Bearer sesijom. Server iz sesije pronalazi owner salon i povezanu test pretplatu, zatim preko Lemon Squeezy Subscription API-ja dobija svež potpisani portal URL. URL se odmah vraća autentifikovanom owneru, ali se ne čuva niti loguje.

## Environment contract

Sledeće server-only vrednosti moraju biti postavljene u kontrolisanom sandbox okruženju:

```text
BILLING_CUSTOMER_PORTAL_ENABLED=true
BILLING_PROVIDER=lemonsqueezy
BILLING_ENVIRONMENT=test
LEMONSQUEEZY_API_KEY=<test secret>
LEMONSQUEEZY_STORE_ID=<test store id>
LEMONSQUEEZY_PORTAL_ALLOWED_HOSTS=rezervo.lemonsqueezy.com
```

Allowlista prihvata samo tačne hostname vrednosti odvojene zarezom. Wildcard, protokol, port i putanja nisu dozvoljeni. API ključ i allowlista nisu `NEXT_PUBLIC_*` vrednosti. Podrazumevani flag ostaje `false`.

## Obavezna dashboard acceptance provera

Pre uključivanja operator u Lemon Squeezy **Design → Customer Portal** ručno potvrđuje:

- promena proizvoda/plana i varijante nije dostupna;
- pause/unpause nije dostupno;
- cancel/resume je dostupno;
- promena payment methoda je dostupna;
- billing information je dostupno;
- invoices/receipts su dostupni;
- Back link vodi na Rezervo Settings → Plaćanje i plan.

Ako dashboard ne omogućava da se plan switching i pause nezavisno isključe, `BILLING_CUSTOMER_PORTAL_ENABLED` mora ostati `false` i sandbox acceptance je blokiran.

## Read-only provera

1. Sa isključenim flagom potvrditi da overview vraća `canOpenCustomerPortal=false` i endpoint vraća kontrolisani disabled odgovor.
2. U izolovanom sandbox scope-u dodati test credentials, Store ID i tačan portal hostname.
3. Kao eksplicitni test owner otvoriti Billing tab; aktivna, cancelled ili past_due provider pretplata prikazuje dugme.
4. Klik mora otvoriti portal u istom tabu. Ne kopirati potpisani URL u log, dokumentaciju ili storage.
5. Trialing i expired pretplate, manager i employee ne dobijaju portal mogućnost.
6. Posle testa vratiti flag na `false` dok dashboard acceptance nije formalno potvrđen.

UI provere koje se rade ručno, jer projekat trenutno nema DOM/React hook test harness:

- owner sa active, cancelled i past_due pretplatom vidi portal dugme samo kada server overview vrati dozvolu;
- manager, employee, trialing i expired stanje ne prikazuju portal dugme;
- dvostruki klik šalje samo jedan zahtev i loading tekst glasi `Otvaranje portala…`;
- uspeh otvara URL kroz `window.location.assign` u istom tabu;
- greška je dostupna kroz `role="alert"`;
- browser storage i konzola ne sadrže portal URL niti njegov query string.

Portal ne menja lokalni subscription direktno. Rezervo stanje i dalje menjanju samo verifikovani webhook lifecycle procesori. Upgrade/downgrade, pause i live režim nisu deo ove faze.
