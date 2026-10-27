# Nordiska Bin – Skötsel

Skötsel-CMS för biodlingen som WordPress-plugin. Appen nås på `/skotsel/` (kräver inloggning, syns inte för sökmotorer) och under *Skötsel* i WP-admin.

Planen finns i `CMS-plan Nordiska Bin.md` i projektmappen. Byggs i faser:

| Fas | Innehåll | Status |
|---|---|---|
| 0 | Grund: organisationer, roller, REST-API, app, egna listor med egna fält | Klar |
| 1 | Bigårdar, kupor, samhällen, drottningar | – |
| 2 | Lager och material | – |
| 3 | Skötselkort och besök | – |
| 4 | Driftplan och uppgifter | – |
| 5–9 | Bihälsa, honung och spårbarhet, avel, ekonomi, offline | – |

## Utveckling

```
npm install
npm run build   # bygger src/ till build/
```

`build/` checkas in så att pluginet kan installeras direkt från GitHub.
Höj `Version` i `nb-skotsel.php` och pusha till `main` för att släppa en uppdatering.

Licens: GPL-2.0-or-later.
