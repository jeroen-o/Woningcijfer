# Woningcijfer

Bouw- en omgevingsscore voor Nederlandse woningen, samengesteld uit openbare
registers. Eén HTML-bestand zonder build-stap, bedoeld om zelfstandig te
draaien of in een iframe te embedden.

De tool geeft een cijfer van 1 tot 10 met een bandbreedte, onderbouwd met een
herkomsttabel waarin per gegeven staat uit welke bron het komt, wanneer het is
opgehaald en of het een geregistreerd feit, een schatting of handmatige invoer
betreft.

> **Dit is geen taxatie en geen advies in de zin van de Wft.** Lees
> [docs/compliance.md](docs/compliance.md) voordat u de tool in een
> adviespraktijk gebruikt.

---

## Snel starten

```bash
git clone <deze-repo> && cd woningcijfer
npm install          # alleen nodig voor de tests
npm run serve        # http://localhost:8080
```

Open `index.html` niet rechtstreeks vanaf schijf. Vanaf `file://` blokkeren
browsers `fetch`, waardoor vrijwel alle databronnen falen. Gebruik
`npm run serve` of GitHub Pages.

```bash
npm run check        # structurele controle + 280 gedragstoetsen
npm test             # alleen de toetsen
npm run validate     # alleen de structurele controle
```

---

## Wat er in zit

| Onderdeel | Bron |
|---|---|
| Adres, coördinaten, gemeente | PDOK Locatieserver |
| Bouwjaar, woonoppervlak, woningtype, buurtoppervlak | BAG (WFS) |
| Perceeloppervlak | Kadastrale kaart, met punt-in-polygoon |
| WOZ-waarde en grondoppervlakte | WOZ-waardeloket |
| Energielabel | EP-Online (bulkexport of API), anders schatting |
| Funderingsindicatie | BRO Bodemkaart, AHN4, BRO grondwater, RVO Funderingsviewer |
| Afstanden en hinderbronnen | OpenStreetMap via Overpass |
| Nabijheid voorzieningen | CBS StatLine 80305NED |
| Buurtstatistieken, inkomen | CBS Kerncijfers wijken en buurten |
| Energieverbruik per buurt | CBS StatLine 81528NED |
| Marktcontext, bodemgebruik, zonnestroom | CBS StatLine |
| Geregistreerde misdrijven | CBS/Politie, tabel 47018NED op `dataderden.cbs.nl` |
| Klimaat, geluid, aardbeving, monument | Diverse, met terugval |

Elk onderdeel faalt zelfstandig. Valt een bron weg, dan blijft het veld op
"onbekend", telt het niet mee in de score, wordt de bandbreedte breder en staat
het als "niet opgehaald" in de herkomsttabel. De tool doet dus nooit alsof ze
iets weet wat ze niet weet.

---

## Repositorystructuur

```
index.html                      de volledige tool, één bestand
data/
  cbs/                          momentopname van CBS StatLine
    manifest.json               welke tabel, welke periode, welke velden
    <onderwerp>/GM0307.json     per gemeente, met de buurten erin
  labels/                       energielabels uit de EP-Online bulkexport
scripts/
  fetch_statline.py             CBS-tabellen ophalen en valideren
  statline_summary.py           samenvatting voor de workflow
  epo_shard.py                  EP-Online CSV omzetten naar shards
  validate_html.py              structurele controles
tests/
  run.js                        runner met samenvatting
  test4.js … test16.js          13 suites, 280 toetsen
docs/
  deploy.md                     publiceren en instellen
  compliance.md                 Wft, AVG en licenties
  privacy.md                    privacyverklaring voor de site
.github/workflows/
  ci.yml                        controle bij elke wijziging
  pages.yml                     publiceren, alleen als de controle groen is
  statline.yml                  CBS-cijfers maandelijks verversen
  labels.yml                    energielabels bouwen (handmatig)
```

---

## Live data of momentopname

De CBS-cijfers kunnen op twee manieren binnenkomen.

**Momentopname (aanbevolen).** De workflow `statline.yml` haalt de tabellen
maandelijks op en zet ze in `data/cbs/`. De tool leest die van de eigen
oorsprong. Dat lost twee zwakke plekken op: CBS hernummert tabellen regelmatig,
en of hun OData-dienst CORS toestaat is niet gegarandeerd. Faalt het ophalen,
dan faalt de workflow — niet het rapport van een gebruiker.

**Live.** Ontbreekt `data/cbs/manifest.json`, dan bevraagt de tool CBS
rechtstreeks. Werkt, maar met bovenstaande risico's.

De herkomsttabel vermeldt per onderwerp welke route is gebruikt, inclusief de
datum van de momentopname.

---

## Onderhoud

**Modelversie.** Wijzigt u een rekenregel of een gewicht, verhoog dan
`MODEL_VERSIE` en `MODEL_DATUM` in `index.html` en zet een git-tag. Het
rapport draagt die versie plus een rapport-ID, waardoor een oude uitkomst
reproduceerbaar is. Zonder tag is die belofte leeg.

Een verversing van `data/cbs/` is géén modelwijziging: de rekenregels blijven
gelijk.

**Drie OData-hosts.** CBS publiceert niet alles op één host. StatLine staat op
`opendata.cbs.nl` en `datasets.cbs.nl`; tabellen van derden, waaronder de
politiecijfers, staan in een eigen catalogus op `dataderden.cbs.nl`. Alle drie
worden geprobeerd. Ontbreekt een host, dan lijkt een tabel onvindbaar terwijl
het nummer klopt.

**Geen regionale bevolkingsprognose.** Dat is een bewuste keuze, geen gemis.
CBS en PBL hebben de detailcijfers van de regionale prognose van StatLine
verwijderd omdat die onvoldoende betrouwbaar bleken, en adviseren uitdrukkelijk
ze niet te gebruiken. Wat resteert is het totaal aantal inwoners, en alleen voor
gemeenten vanaf 50.000 inwoners. De tool toont daarom de huidige vergrijzing in
de buurt, met de melding dat het geen vooruitzicht is.

**Een CBS-tabel valt weg.** De workflow meldt dat in de stapsamenvatting. Zoek
het nieuwe nummer op <https://opendata.cbs.nl/statline>, vul het aan bij
`ONDERWERPEN` in `scripts/fetch_statline.py` én bij `STATLINE` in `index.html`.
`validate_html.py` controleert dat die twee registers gelijk blijven.

**Een veldnaam wijzigt.** Veldnamen worden op naam herkend met meerdere
varianten per veld. Voeg de nieuwe variant toe aan de lijst; de oude mag blijven
staan.

---

## Wat de controle vangt

`validate_html.py` toetst de fouten die dit project echt heeft gehad en die een
browser niet meldt:

- een klassenaam zonder stijlregel (kwam voor bij de labelknop en bij vijf
  secties in het printblad)
- een host die wordt aangeroepen maar niet in de Content-Security-Policy staat
- een printblad dat achterloopt op de secties die erin worden gegoten
- browseropslag, die in deze tool is uitgesloten vanwege embedden in Google Sites
- uiteenlopende StatLine-registers tussen tool en script
- ontbrekende compliance-voorbehouden

De 280 gedragstoetsen draaien de tool in jsdom met een nagebootste netwerklaag
en dekken onder meer: de perceelkeuze via punt-in-polygoon, terugval tussen
Overpass-spiegelservers, stille time-outs die als geslaagd werden gezien, de
indexatie van de waardeberekening, contrastverhoudingen en de printopmaak.

---

## Bekende beperkingen

- **Overpass is traag en vaak overbelast.** Drie spiegelservers, de opdracht in
  twee delen, en bij uitval een knop "opnieuw proberen".
- **Het WOZ-waardeloket heeft geen gedocumenteerde open API.** De tool gebruikt
  het endpoint dat de site zelf aanroept. Blokkeert CORS dat, dan blijft er een
  deeplink naar het loket voor dit adres.
- **CORS wordt bepaald door de bronhouder**, niet door waar deze pagina staat.
  GitHub Pages lost dat niet op. Wilt u dat wel oplossen, dan is een kleine
  serverloze functie nodig; zie [docs/deploy.md](docs/deploy.md).
- **Het energielabel vereist een keuze.** De EP-Online API vraagt een
  abonnementssleutel; zonder sleutel of bulkexport valt de tool terug op een
  schatting op bouwjaar, en meldt dan expliciet dat niet is vastgesteld of er
  een geregistreerd label bestaat. Zie [docs/deploy.md](docs/deploy.md).
- **Woningtype is een afleiding.** De BAG kent geen veld voor woningtype. Het
  wordt bepaald uit de pandcontour en het aantal verblijfsobjecten, en staat als
  schatting in de herkomsttabel.
- **De indicatieve waarde is geen taxatie.** Twee methodes naast elkaar, met de
  spreiding als signaal. Zie [docs/compliance.md](docs/compliance.md).
