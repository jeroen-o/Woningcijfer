# Compliance

Dit document is bedoeld voor wie de tool in een adviespraktijk of op een
publieke site gebruikt. Het beschrijft de grenzen die in de tool zijn ingebouwd
en de keuzes die u zelf nog moet maken.

---

## 1. Wft — geen advies, geen taxatie

De tool geeft algemene informatie uit openbare registers. Er vindt geen
inventarisatie van een persoonlijke situatie plaats en er wordt geen product
geadviseerd. Dat staat op vier plekken in de uitvoer.

**Gebruikt u dit in een adviesgesprek**, leg dan in het dossier vast:

- dat het een indicatie uit publieke bronnen betreft;
- de **modelversie** en het **rapport-ID** van het rapport;
- dat bouwkundig en/of funderingsonderzoek nodig is voordat er financiële
  conclusies aan worden verbonden.

Het rapport-ID en de modelversie staan in de kop van het printrapport. Zet per
modelversie een git-tag, anders is een oud rapport niet te reproduceren.

### Onderdelen met een verhoogd risico

| Onderdeel | Risico | Ingebouwde markering |
|---|---|---|
| Indicatieve waarde | Wordt gelezen als taxatie | "nadrukkelijk geen taxatie", niet bruikbaar voor financiering, met de rekenkundige zwakte uitgelegd |
| Extra leenruimte per label | Wordt gelezen als hypotheekadvies | "geen hypotheekadvies", voorwaarden benoemd, waarschuwing dat de ruimte vervalt zonder geregistreerd label |
| Geschat energielabel | Wordt gelezen als geregistreerd label | oranje badge op het scherm, "SCHATTING op bouwjaar, geen geregistreerd label" in het rapport |
| Funderingsindicatie | Wordt gelezen als onderzoek | "geen funderingsonderzoek", met verwijzing naar KCAF |
| Geluidbelasting Lden | Wordt gelezen als officiële waarde | gemarkeerd als akoestische schatting uit afstanden |

Verwijder deze markeringen niet. `validate_html.py` faalt als de belangrijkste
verdwijnen; dat is opzet.

### De indicatieve waarde

Twee methodes staan naast elkaar: gemiddelde verkoopprijs per vierkante meter,
en de eigen WOZ-waarde geïndexeerd. Dat is geen onbeslistheid maar informatie:
lopen ze ver uiteen, dan zegt een gemiddelde weinig over dit pand. Bij een
spreiding vanaf 15% meldt de tool dat expliciet.

De bekende zwakte staat in het rapport: methode A deelt een gemeentegemiddelde
door een buurtgemiddelde, en prijs per vierkante meter is niet lineair.

---

## 2. AVG

### Wat de tool zelf doet

Geen database, geen cookie, geen browseropslag. Het ingevoerde adres wordt
alleen gebruikt om de registers te bevragen en verdwijnt bij het sluiten van de
pagina. Een opgeslagen JSON-bestand of gedeelde link bevat wél het adres en alle
invoer.

### Wat derden doen

Dit is de verwerking die u moet vastleggen:

| Partij | Verwerkt | Rol |
|---|---|---|
| PDOK / Kadaster | opgevraagde adressen en coördinaten | bronhouder, eigen logging |
| CBS | gebiedscodes (bij live gebruik) | bronhouder |
| RVO / EP-Online | postcode en huisnummer | bronhouder |
| WOZ-waardeloket | nummeraanduiding | bronhouder |
| OpenStreetMap / Overpass | coördinaten | bronhouder |
| GitHub (bij Pages) | IP-adressen van bezoekers | hostingpartij |

Bij hosting op GitHub Pages is **GitHub een verwerker in uw keten**. Neem dat op
in uw verwerkingsregister. Gebruikt u de momentopname in `data/cbs/`, dan valt
CBS uit deze lijst; dat is een privacyvoordeel bovenop de betrouwbaarheid.

Pas [privacy.md](privacy.md) aan met uw eigen gegevens en publiceer die op de
site.

### Adresgegevens zijn persoonsgegevens

Een adres met bouwjaar, energielabel en WOZ-waarde is herleidbaar tot een
huishouden. Bewaar rapporten volgens uw eigen bewaartermijnen en deel een
gedeelde link niet ongecontroleerd.

---

## 3. Discriminatieverbod

De tool toont inkomens- en misdaadcijfers per buurt. Die zijn openbaar, maar het
gebruik is begrensd.

> Het weigeren van dienstverlening of het hanteren van andere voorwaarden op
> basis van postcode- of buurtkenmerken is indirecte discriminatie en in strijd
> met de Algemene wet gelijke behandeling.

Beoordeel een klant op de eigen situatie, niet op de buurt. Die waarschuwing
staat bij het inkomensblok in de tool zelf.

Bewuste keuzes in de vormgeving, die u niet zonder reden moet terugdraaien:

- **Inkomen en misdrijven tellen niet mee in het Woningcijfer.** Een woning
  wordt niet beter of slechter van het inkomen van de omgeving.
- **Geen oordeelskolom en geen kleurcodering bij inkomen.** Een rood cijfer bij
  "huishoudens onder het sociaal minimum" is een oordeel vermomd als opmaak.
- **Altijd drie schaalniveaus**, zodat een percentage nooit los in beeld staat.
- **Bij misdrijven een vaste leesinstructie** over aangiftebereidheid,
  registratie op plaats delict, en de ruis in kleine buurten.

---

## 4. Licenties en hergebruik

| Bron | Voorwaarde |
|---|---|
| PDOK / Kadaster | open data, bronvermelding verplicht |
| CBS | open data, bronvermelding verplicht |
| OpenStreetMap | ODbL — bronvermelding en gelijke voorwaarden bij afgeleide databases |
| EP-Online bulkexport | **voorwaarden van RVO; herpublicatie is niet vrij** |
| Scholen op de kaart, De VO Gids | geen open koppeling; alleen verwijzen, niet inlezen |

De bronvermeldingen staan in de tool en in het printrapport. Laat ze staan.

### ⚠️ De EP-Online bulkexport

Dit is het punt om te beslissen voordat u publiceert.

Het opzoeken van één adres is iets anders dan het publiceren van de volledige
dataset. Zet u `data/labels/` op een publieke Pages-site, dan is elke shard voor
iedereen downloadbaar en herpubliceert u in feite de hele set.

Drie opties:

1. **Niet publiceren.** Laat `data/labels/` uit de repository en laat de tool op
   de EP-Online API terugvallen, met een schatting als die faalt. Veiligste
   optie, minste gemak.
2. **Achter een serverloze functie**, die per verzoek alleen de opgevraagde
   postcode teruggeeft. Juridisch sterker en functioneel gelijkwaardig. Zie
   [deploy.md](deploy.md).
3. **Publiceren na toetsing** van de RVO-voorwaarden, eventueel met schriftelijke
   bevestiging.

`.gitignore` sluit `data/labels/` standaard uit. Dat is opzet: het moet een
bewuste handeling zijn om die erin te zetten.

### Peildatum

De bulkexport heeft een peildatum. Labels die daarna zijn afgegeven ontbreken.
De tool leest die datum uit `meta.json` en vermeldt hem in de footer, de
herkomsttabel en het rapport. Verwijder dat niet: anders presenteert u
verouderde data als geregistreerd feit.

---

## 5. Bij een klacht of toetsing

Wat u moet kunnen overleggen:

1. **Het rapport** met modelversie en rapport-ID.
2. **De modelversie uit de repository**, via de git-tag.
3. **De herkomsttabel** uit dat rapport: per gegeven de bron, het tijdstip en
   of het een registerfeit, een schatting of handmatige invoer was.
4. **De peildatum** van de gebruikte momentopnames.

Dat is precies waarvoor de herkomsttabel bestaat. Een uitkomst zonder herkomst
is bij een toetsing niet te verdedigen.
