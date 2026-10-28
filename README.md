# Nordiska Bin – Skötsel

Skötsel-CMS för biodlingen som WordPress-plugin. Appen nås på `/skotsel/` (kräver inloggning, syns inte för sökmotorer) och under *Skötsel* i WP-admin.

Planen finns i `CMS-plan Nordiska Bin.md` i projektmappen. Byggs i faser:

| Fas | Innehåll | Status |
|---|---|---|
| 0 | Grund: organisationer, roller, REST-API, app, egna listor med egna fält | Klar |
| 1 | Bigårdar, kupor, samhällen, drottningar med historik och karta | Klar |
| 2 | Lager och material, körplanering för bigårdsbesök | Klar |
| 3 | Skötselkort (egna mallar) och besök i fält | Klar |
| 4 | Driftplan: årsplan, dragkalender, veckans arbete per slinga | Klar |
| 5 | Bihälsa och foder | Klar |
| 6 | Honung och spårbarhet, HACCP | Klar |
| 7 | Avel och drottningodling | Klar |
| 8 | Ekonomi och nyckeltal | Klar |
| 9 | Offline (PWA), QR-koder, Excel-export och -import | Klar |

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

### Fas 4–8: generiska register

Driftplan (`plan`), bihälsa (`health`), partier (`batch`), tappningar (`fill`), leveranser (`delivery`),
egenkontroll (`haccp`), bedömningar (`evaluation`), odlingsserier (`rearing`), budget, utfall (`ledger`) och
investeringar definieras i `NBS_Entities::TYPES` och nås via `/r/<typ>` – samma validering, ändringslogg och
egna fält som övriga register. Logik som går utöver det ligger i `NBS_Domain`: import av driftplanen
(`data/driftplan.json`), avbockning per år, behandling av flera samhällen med lageruttag, foder i torrsubstans
per samhälle, partikoder (ÅR-BIGÅRD-NR), tappning med burkar från lagret och ekonomi med nyckeltal.

### Fas 9: fält och export

- `/skotsel/sw.js` (`assets/sw.js`) och `/skotsel/manifest.webmanifest`: appen kan läggas på hemskärmen och
  visar senast hämtade uppgifter utan täckning. Besök sparas i telefonen (localStorage) tills servern tagit emot dem.
  Allt sparat töms vid utloggning.
- QR-etiketter för kuporna (Samhällen → Kupor) öppnar `#/kupa/<id>` → samhället i kupan.
- Excel: export av alla register (Inställningar → Export) och import av samhällen genom att klistra in rader.
- KML/KMZ-import av bigårdarnas positioner (Bigårdar → Importera karta).

### Kupbibliotek och kupbyggare

- `library/index.json` är det gemensamma kupbiblioteket: märken, system (fotavtryck, antal ramar), delar
  (botten, låda, tak … med mått och källa: standard/datablad/uppmätt) och ramformat. Pluginet läser filen
  från GitHub (`main`), cachat i 12 timmar, med pluginets kopia som reserv – nya delar når alla utan ny version.
- `library/ramar/*.glb` genereras från ramprojektet (`Fristad/3D-ramar`):
  `blender -b -P exportera_glb.py -- <nb-skotsel>/library` (skriver även `frames` i index.json).
- `#/kupbyggare`: dra delar till kupan (three.js, laddas separat), antal per del, ramar per låda,
  genomskinlig/isärdragen vy, materiallista för N kupor, export som PNG och GLB.
- Inställningar → Uppdateringar: sök efter nytt i biblioteket och pluginet, och uppdatera pluginet direkt.

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
