# Publiceren en instellen

## GitHub Pages

1. **Repository instellen.** Settings → Pages → Source: **GitHub Actions**.
   Niet "Deploy from a branch": `pages.yml` publiceert alleen als de controle
   groen is, en dat filter verliest u met de branch-optie.

2. **Eerste publicatie.** Push naar `main`, of start "Publiceren" handmatig.
   De URL verschijnt in de workflow-samenvatting.

3. **Eigen domein (optioneel).** Zet de domeinnaam in een bestand `CNAME` in de
   repositoryroot; `pages.yml` neemt dat mee. Richt bij uw DNS een CNAME in naar
   `<gebruiker>.github.io`.

### Private repository

Pages werkt bij een private repository alleen op een betaald plan. Op het gratis
plan is de site publiek zodra u Pages aanzet, ook als de code privé is. Dat is
relevant voor de energielabels: zie [compliance.md](compliance.md).

Voor een besloten test kunt u `npm run serve` gebruiken, of een preview-omgeving
bij Netlify of Cloudflare Pages met wachtwoordbeveiliging.

---

## CBS-cijfers klaarzetten

```bash
# Alles ophalen, circa 10 tot 20 minuten
python3 scripts/fetch_statline.py --uit data/cbs

# Eerst uitproberen zonder wegschrijven
python3 scripts/fetch_statline.py --dryrun --max 20000

# Eén onderwerp
python3 scripts/fetch_statline.py --onderwerp nabijheid --uit data/cbs
```

De workflow `statline.yml` doet dit maandelijks en opent een pull request bij
wijzigingen. Zo ziet u wat er verandert voordat het live gaat.

Controleer na het ophalen `data/cbs/manifest.json`: daarin staat per onderwerp
welke tabel is gebruikt, over welke periode, en welke velden niet gevonden zijn.
Een gemist veld betekent doorgaans dat CBS een kolomnaam heeft gewijzigd.

---

## Energielabels klaarzetten

```bash
# Kolomherkenning controleren voordat u 1,6 GB verwerkt
python3 scripts/epo_shard.py v20260801_v4_csv.csv --toon-header

# Steekproef
python3 scripts/epo_shard.py v20260801_v4_csv.csv --uit data/labels --max 100000

# Alles
python3 scripts/epo_shard.py v20260801_v4_csv.csv --uit data/labels
```

Staat de uitvoer in `data/labels/` naast `index.html`, dan gebruikt de tool die
zonder verdere instellingen: dezelfde oorsprong, dus geen CORS-header en geen
CSP-aanpassing nodig.

Wilt u de labels op een andere host zetten, vul dan de volledige URL in bij
`LABEL_LOOKUP.basis` in `index.html` **en** voeg die host toe aan de
`connect-src` in de Content-Security-Policy bovenaan hetzelfde bestand. Zonder
die tweede stap blokkeert de browser het verzoek zonder duidelijke melding.

Tijdelijk testen zonder het bestand te wijzigen: `?labels=https://host/pad`.

⚠️ Lees [compliance.md](compliance.md) over herpublicatie van de dataset.

---

## Wat GitHub Pages niet oplost

CORS wordt bepaald door de bronhouder, niet door waar uw pagina staat. Deze
blijven dus onzeker:

| Bron | Verwachting |
|---|---|
| PDOK (BAG, kadaster, AHN, BRO, RVO, CBS-WFS) | werkt, staat CORS toe |
| CBS OData | onzeker; daarom de momentopname |
| WOZ-waardeloket | onzeker, geen gedocumenteerde API |
| Overpass | werkt, maar traag en vaak overbelast |
| EP-Online API | wisselend beschikbaar |

### Serverloze functie als aanvulling

Eén klein doorgeefluik lost het restant op. Cloudflare Workers en Netlify
Functions zijn gratis voor dit volume. Schets:

```js
// Cloudflare Worker: doorgeefluik met cache
export default {
  async fetch(request, env, ctx) {
    const { searchParams } = new URL(request.url);
    const doel = searchParams.get('url');

    // Alleen bekende bronhouders doorgeven, anders bouwt u een open proxy
    const toegestaan = [
      'https://www.wozwaardeloket.nl/',
      'https://opendata.cbs.nl/',
      'https://overpass-api.de/',
    ];
    if (!doel || !toegestaan.some(t => doel.startsWith(t))) {
      return new Response('niet toegestaan', { status: 403 });
    }

    const cache = caches.default;
    let antwoord = await cache.match(request);
    if (!antwoord) {
      antwoord = new Response(await (await fetch(doel)).text(), {
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': 'https://uw-domein.nl',
          'cache-control': 'public, max-age=86400',
        },
      });
      ctx.waitUntil(cache.put(request, antwoord.clone()));
    }
    return antwoord;
  },
};
```

Beperk `access-control-allow-origin` tot uw eigen domein en de toegestane
doelen tot de bronhouders die u werkelijk nodig heeft. Een open proxy wordt
binnen dagen gevonden en misbruikt.

Voeg daarna de Worker-host toe aan de `connect-src` in de CSP.

---

## Embedden in Google Sites

De tool is hierop voorbereid:

- `frame-ancestors *` in de CSP staat embedden toe.
- Er wordt **geen** browseropslag gebruikt; Google Sites blokkeert dat in een
  iframe. De controle in `validate_html.py` faalt als iemand dat per ongeluk
  toevoegt.
- Printen gaat via `window.open()`, omdat `window.print()` in een iframe
  geblokkeerd wordt.

Insluiten: Invoegen → Insluiten → Via URL, met de Pages-URL.

Werkt de kaart niet in het iframe, controleer dan of `img-src` nog
`https://service.pdok.nl` bevat.

---

## Controleren of het echt werkt

De toetsen draaien tegen een nagebootste netwerklaag. Dat vangt gedragsfouten,
maar niet of de echte diensten antwoorden. Doe daarom na elke publicatie één
handmatige controle:

1. Analyseer een adres dat u kent, bijvoorbeeld een tussenwoning met een
   afwijkend perceel.
2. Controleer in het rapport:
   - **Perceeloppervlak** — klopt het met de BAG-viewer? De tool kiest het
     perceel dat het adrespunt omsluit, maar bij een onzekere treffer staat dat
     in de herkomsttabel.
   - **Statusblok "Niet opgehaald uit StatLine"** — welke onderwerpen falen?
   - **Databetrouwbaarheid** — onder de 50% ontbreken er te veel bronnen.
   - **Energielabel** — geregistreerd of schatting?
3. Druk af naar PDF en kijk of de sectie-afbrekingen op A4 goed vallen.

Loopt er iets mis, dan staat in de browserconsole welke bron het liet afweten.
