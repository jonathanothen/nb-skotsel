# Nordiska Bin – Skötsel

Skötsel-CMS för biodlingen som WordPress-plugin. Appen nås på `/skotsel/` (kräver inloggning, syns inte för sökmotorer) och under *Skötsel* i WP-admin.

Planen finns i `CMS-plan Nordiska Bin.md` i projektmappen. Byggs i faser:

| Fas | Innehåll | Status |
|---|---|---|
| 0 | Grund: organisationer, roller, REST-API, app, egna listor med egna fält | Klar |
| 1 | Bigårdar, kupor, samhällen, drottningar med historik och karta | Klar |
| 2 | Lager och material, körplanering för bigårdsbesök | Klar |
| 3 | Skötselkort (egna mallar) och besök i fält | Klar |
| 4 | Driftplan och uppgifter | – |
| 5–9 | Bihälsa, honung och spårbarhet, avel, ekonomi, offline | – |

### Datamodell (fas 1)

- `nbs_apiaries`, `nbs_hives`, `nbs_colonies`, `nbs_queens` – nuläget. Fasta kolumner för
  kopplingar och filter, egna fält per register i `data` (definieras under *Egna fält*).
- `nbs_events` – historiken. Flytt, kupbyte, drottningbyte, delning, sammanslagning,
  statusändring, död/såld och anteckningar sparas med datum. Operationerna i
  `NBS_Ops` uppdaterar nuläget och skriver händelser i samma transaktion.
- Kolumnerna definieras i `NBS_Entities::TYPES`, som också styr tabellschemat.

### Lager (fas 2)

- Artiklarna är posterna i listan *Material och artiklar*; lagerplatser är listan *Lagerplatser*
  plus bigårdar och kupor.
- `nbs_stock_tx` – varje rörelse (inköp, flytt, förbrukning, kassering, inventering) med från/till,
  samhälle, bigård och pris. Bokningar som hör ihop (t.ex. en fördelning) delar `batch_id` och kan ångras.
- `nbs_stock` – saldo per artikel och plats, uppdateras i samma transaktion. Kan byggas om från
  rörelserna (`POST /stock/rebuild`).

### Skötselkort och besök (fas 3)

- `nbs_templates` – skötselkorten: syfte, rutinsteg, checklista, material (lagerartikel, mängd per samhälle/bigård/besök,
  förbrukas eller till kupan) och kupkontrollfält (samma fälttyper som listorna, plus skala; ett fält kan uppdatera styrkan).
  Korten från driftplan.xlsx finns i `data/skotselkort.json` och läggs in med en knapp.
- `nbs_visits` + `nbs_inspections` – besök per bigård och kupkontroll per samhälle. Sparas löpande.
  *Avsluta besöket* bokar materialet i lagret, skriver händelsen `besok` i varje samhälles historik och uppdaterar
  styrkan, allt i en transaktion. *Öppna igen* ångrar lagerbokningar och händelser.
- Utskrift: `#/besok/<id>/utskrift` ger kortet som A4 med bigårdens samhällen ifyllda.

### Körplanering

`#/bigardar/rutt` – välj bigårdar eller en hel slinga, start/mål, optimera ordningen (OSRM-körtider,
närmaste granne + 2-opt) och öppna rutten i Google Maps (max 9 mellanstopp per länk, delas automatiskt)
eller Apple Kartor. Bigårdarnas position kan klistras in som Google Maps-länk, koordinater eller hämtas med GPS.

## Utveckling

```
npm install
npm run build   # bygger src/ till build/
```

`build/` checkas in så att pluginet kan installeras direkt från GitHub.
Höj `Version` i `nb-skotsel.php` och pusha till `main` för att släppa en uppdatering.

Licens: GPL-2.0-or-later.
