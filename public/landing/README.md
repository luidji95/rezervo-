# Rezervo landing assets

Ovaj folder sadrži statičke marketinške assete. Ne koristi bazu ili Supabase Storage.

## Slike (poster pre klika)

Stvarni, anonimizovani snimci ekrana demo salona "Mala Sirena" (izmišljeni podaci iz lokalne baze), 1600 × 1000 px, WebP:

- `dashboard.webp`: dashboard vlasnika
- `calendar.webp`: kalendar sa otvorenim detaljima termina
- `clients.webp`: CRM klijenata, sortirano po prometu, otvoren profil
- `team.webp`: zaposleni i njihov profil
- `statistics.webp`: statistika za poslednja 3 meseca

Stari `.svg` fajlovi su bili privremeni fallback i više se ne koriste.

## Video snimci (`videos/`)

Nemi snimci ekrana, H.264 MP4, 1920 × 1200, 30 fps, ~15 s, 1,3–3,1 MB. Puštaju se u krug u sekciji "Saznajte više" i otvaraju klikom na sliku u sekciji "Kako izgleda Rezervo":

- `dashboard-showcase.mp4`
- `calendar-showcase.mp4`
- `clients-showcase.mp4`
- `team-showcase.mp4`
- `statistics-showcase.mp4`

## Kako se prave

Snimci se prave automatski skriptom (Playwright snima lokalnu aplikaciju kadar po kadar, sa vidljivim kursorom za klikove), iz foldera `C:\Users\User\Claude Code Assistent\rezervo-snimci`:

1. Pokrenuti lokalnu aplikaciju nad LOKALNOM Supabase bazom: `start-local-demo.ps1` (SMS i billing isključeni; server i browser "vide" 25. septembar 2026, da statistika meseca ima podatke)
2. `node record.mjs <dashboard|calendar|clients|employees|statistics>`
3. `.\encode.ps1 <ime>` pravi MP4, a `node make-posters.mjs` pravi WebP slike

Posle promene dizajna aplikacije dovoljno je ponoviti korake 2–3.

Pre snimanja nikad ne koristiti stvarne podatke klijenata, telefone ili email adrese.
