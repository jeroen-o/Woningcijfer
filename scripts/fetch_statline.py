#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fetch_statline.py — CBS StatLine-tabellen vooraf ophalen en valideren.

Waarom dit bestaat
------------------
De tool kan de CBS-cijfers live ophalen, maar dat kent twee zwakke plekken:
CBS hernummert tabellen regelmatig, en of hun OData-dienst CORS toestaat is
niet gegarandeerd. Als het live ophalen faalt, merkt de gebruiker dat pas in
het rapport.

Dit script haalt dezelfde tabellen op in een workflow. Faalt er iets, dan
faalt de build — luid, en voordat een gebruiker het ziet. De uitvoer is een
set kleine JSON-bestanden die de tool van de eigen oorsprong leest.

Uitvoer
-------
    data/cbs/manifest.json              welke tabel, welke periode, welke velden
    data/cbs/<onderwerp>/GM0307.json    { buurtcode: {veld: waarde} }

Per gemeente één bestand, zodat de browser enkele tientallen kB ophaalt in
plaats van een tabel van vele megabytes.

Gebruik
-------
    python3 fetch_statline.py --uit data/cbs
    python3 fetch_statline.py --uit data/cbs --onderwerp nabijheid --dryrun
    python3 fetch_statline.py --uit data/cbs --strict       # faalt bij elk gemis

Exitcodes
---------
    0  alles opgehaald
    1  een of meer onderwerpen niet opgehaald (met --strict), of een fout
    2  geen enkel onderwerp gelukt
"""

import argparse
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HOSTS = [
    'https://opendata.cbs.nl/ODataApi/odata/',
    'https://datasets.cbs.nl/odata/v1/CBS/',
    # Tabellen van derden (o.a. de politiecijfers) staan in een eigen
    # catalogus op een eigen host.
    'https://dataderden.cbs.nl/ODataApi/OData/',
]

# Deze definities moeten gelijk blijven aan het STATLINE-register in de tool.
# Wijzigt hier een veldnaam, wijzig hem daar ook — validate_html.py controleert
# dat de onderwerpsnamen aan beide kanten overeenkomen.
ONDERWERPEN = {
    'nabijheid': {
        'titel': 'Nabijheid voorzieningen',
        'tabellen': ['80305NED', '84463NED'],
        'niveau': 'buurt',
        'velden': {
            'dHuisarts': ['AfstandTotHuisartsenpraktijk'],
            'dZiekenhuis': ['AfstandTotZiekenhuisExclBuitenpolikl', 'AfstandTotZiekenhuis'],
            'dApotheek': ['AfstandTotApotheek'],
            'dHuisartsenpost': ['AfstandTotHuisartsenpost'],
            'dKinderopvang': ['AfstandTotKinderdagverblijf'],
            'dBuitenschools': ['AfstandTotBuitenschoolseOpvang'],
            'dSupermarkt': ['AfstandTotGroteSupermarkt'],
            'dWarenhuis': ['AfstandTotWarenhuis'],
            'dCafe': ['AfstandTotCafeED', 'AfstandTotCafe'],
            'dRestaurant': ['AfstandTotRestaurant'],
            'dBibliotheek': ['AfstandTotBibliotheek'],
            'dZwembad': ['AfstandTotZwembad'],
            'dSportterrein': ['AfstandTotSportterrein'],
            'dStation': ['AfstandTotTreinstationsTotaal', 'AfstandTotTreinstation'],
            'dOprit': ['AfstandTotOpritHoofdverkeersweg'],
            'dBrandweer': ['AfstandTotBrandweerkazerne'],
            'dBasisschool': ['AfstandTotSchoolBasisonderwijs', 'AfstandTotBasisonderwijs'],
            'dVmbo': ['AfstandTotSchoolVmbo', 'AfstandTotVmbo'],
            'dHavoVwo': ['AfstandTotSchoolHavoVwo', 'AfstandTotHavoVwo'],
            'nBasisschool3': ['ScholenBinnen3KmBasisonderwijs', 'BasisonderwijsBinnen3Km'],
            'nVmbo3': ['ScholenBinnen3KmVmbo', 'VmboBinnen3Km'],
            'nHavoVwo5': ['ScholenBinnen5KmHavoVwo', 'HavoVwoBinnen5Km'],
            'nSupermarkt3': ['GroteSupermarktBinnen3Km'],
            'nHuisarts3': ['HuisartsenpraktijkBinnen3Km'],
        },
        'verplicht': ['dHuisarts', 'dSupermarkt'],
    },
    'energie': {
        'titel': 'Energieverbruik woningen',
        'tabellen': ['85999NED', '81528NED', '84314NED'],
        'niveau': 'buurt',
        'velden': {
            'gas': ['GemiddeldAardgasverbruikTotaal', 'GemiddeldAardgasverbruik'],
            'gasAppartement': ['GemiddeldAardgasverbruikAppartement'],
            'gasTussen': ['GemiddeldAardgasverbruikTussenwoning'],
            'gasHoek': ['GemiddeldAardgasverbruikHoekwoning'],
            'gasTwee': ['GemiddeldAardgasverbruikTweeOnderEenKapWoning'],
            'gasVrij': ['GemiddeldAardgasverbruikVrijstaandeWoning'],
            'stroom': ['GemiddeldElektriciteitsverbruikTotaal', 'GemiddeldElektriciteitsverbruik'],
            'pctStadsverwarming': ['PercentageWoningenMetStadsverwarming'],
        },
        'verplicht': ['gas'],
    },
    'verkoop': {
        'titel': 'Verkoopprijzen bestaande koopwoningen',
        'tabellen': ['83625NED', '83906NED', '85773NED'],
        'niveau': 'gemeente',
        'velden': {
            'gemiddeldePrijs': ['GemiddeldeVerkoopprijs'],
            'aantalVerkocht': ['VerkochteWoningen', 'AantalVerkochteWoningen'],
            'prijsindex': ['PrijsindexBestaandeKoopwoningen', 'Prijsindex'],
            'ontwikkeling': ['OntwikkelingTOVEenJaarEerder', 'VeranderingTOVEenJaarEerder'],
        },
        'verplicht': ['gemiddeldePrijs'],
    },
    'bodem': {
        'titel': 'Bodemgebruik',
        'tabellen': ['86211NED', '86210NED', '70262NED'],
        'niveau': 'buurt',
        'velden': {
            'totaal': ['TotaleOppervlakte'],
            'verkeer': ['Verkeersterrein', 'TotaalVerkeersterrein'],
            'bebouwd': ['TotaalBebouwdTerrein', 'BebouwdTerrein'],
            'recreatie': ['TotaalRecreatieterrein', 'Recreatieterrein'],
            'agrarisch': ['TotaalAgrarischTerrein', 'AgrarischTerrein'],
            'natuur': ['TotaalBosEnOpenNatuurlijkTerrein', 'BosEnOpenNatuurlijkTerrein'],
            'binnenwater': ['TotaalBinnenwater', 'Binnenwater'],
        },
        'verplicht': ['totaal'],
    },
    'zon': {
        'titel': 'Zonnestroom bij woningen',
        'tabellen': ['86044NED', '85005NED'],
        'niveau': 'buurt',
        'velden': {
            'vermogen': ['OpgesteldVermogenZonnepanelen', 'OpgesteldVermogen'],
            'installaties': ['AantalInstallaties', 'Installaties'],
            'perWoning': ['OpgesteldVermogenPerWoning'],
        },
        'verplicht': [],
    },
    'inkomen': {
        'titel': 'Inkomen en bestaanszekerheid',
        'tabellen': ['85064NED', '84639NED', '83765NED'],
        'niveau': 'buurt',
        'velden': {
            'inkomenPerInwoner': ['GemiddeldInkomenPerInwoner'],
            'inkomenPerOntvanger': ['GemiddeldInkomenPerInkomensontvanger'],
            'pctLaagInkomen': ['HuishoudensMetLaagsteInkomen', 'PercentageHuishoudensMetLaagInkomen'],
            'pctHoogInkomen': ['HuishoudensMetHoogsteInkomen', 'PercentageHuishoudensMetHoogInkomen'],
            'pctSociaalMinimum': ['HuishoudensOnderOfRondSociaalMinimum', 'HuishoudensMetEenLaagInkomen'],
            'pctUitkering': ['PersonenPerSoortUitkeringBijstand', 'PercentagePersonenMetUitkering'],
        },
        'verplicht': [],
    },
}

REGIO_VELDEN = ['WijkenEnBuurten', 'RegioS', 'Regio', 'RegioSVanTot']

# De regionale bevolkingsprognose is opzettelijk niet opgenomen. CBS en PBL
# hebben de detailcijfers van StatLine verwijderd omdat die onvoldoende
# betrouwbaar bleken, en adviseren uitdrukkelijk ze niet te gebruiken.
# Wat resteert is het totaal aantal inwoners, en alleen voor gemeenten vanaf
# 50.000 inwoners.


def log(*a):
    sys.stderr.write(' '.join(str(x) for x in a) + '\n')
    sys.stderr.flush()


def haal(url, pogingen=3, pauze=2.0):
    """GET met eenvoudige herhaling; CBS geeft af en toe een 503."""
    laatste = None
    for poging in range(pogingen):
        try:
            req = urllib.request.Request(url, headers={
                'Accept': 'application/json',
                'User-Agent': 'woningcijfer-statline-prefetch/1.0 (+github actions)',
            })
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:  # noqa: BLE001 — elke fout is een reden om te herhalen
            laatste = e
            if poging < pogingen - 1:
                time.sleep(pauze * (poging + 1))
    raise laatste


def norm(x):
    return re.sub(r'[^a-z0-9]', '', str(x).lower())


def zoek_veld(kolommen, kandidaten):
    """Herken een kolom op naam. CBS hangt volgnummers achter de veldnamen
    (_1, _12), dus exact vergelijken werkt niet."""
    gen = {norm(k): k for k in kolommen}
    for kandidaat in kandidaten:
        n = norm(kandidaat)
        if n in gen:
            return gen[n]
        for g, orig in gen.items():
            if g.startswith(n):
                return orig
    return None


def gemeente_van(code):
    """BU03072801 -> GM0307, WK030728 -> GM0307, GM0307 -> GM0307."""
    c = str(code).strip()
    if c.startswith('GM'):
        return c[:6]
    if c.startswith(('BU', 'WK')):
        return 'GM' + c[2:6]
    return None


def haal_tabel(host, tabel, maxrijen=0):
    """Haalt de volledige TypedDataSet op, in pagina's van 10.000 rijen."""
    rijen = []
    skip = 0
    while True:
        url = host + tabel + '/TypedDataSet?$skip=%d' % skip
        d = haal(url)
        deel = d.get('value') or []
        rijen.extend(deel)
        if len(deel) < 10000:
            break
        skip += len(deel)
        if maxrijen and len(rijen) >= maxrijen:
            break
        if skip > 2000000:      # veiligheidsrem
            log('  ! meer dan 2 miljoen rijen; afgebroken')
            break
    return rijen


def verwerk_onderwerp(naam, cfg, maxrijen=0):
    """Probeert de kandidaat-tabellen tot er een bruikbare bij zit."""
    for host in HOSTS:
        for tabel in cfg['tabellen']:
            try:
                log('  probeer %s op %s' % (tabel, host.split('/')[2]))
                rijen = haal_tabel(host, tabel, maxrijen)
            except Exception as e:  # noqa: BLE001
                log('    niet beschikbaar: %s' % e)
                continue
            if not rijen:
                log('    leeg antwoord')
                continue

            kolommen = list(rijen[0].keys())
            regioveld = zoek_veld(kolommen, REGIO_VELDEN)
            periodeveld = zoek_veld(kolommen, ['Perioden', 'Periode'])
            if not regioveld:
                log('    geen regiokolom gevonden')
                continue

            kaart = {}
            gemist = []
            for veld, kandidaten in cfg['velden'].items():
                k = zoek_veld(kolommen, kandidaten)
                if k:
                    kaart[veld] = k
                else:
                    gemist.append(veld)

            ontbrekend_verplicht = [v for v in cfg.get('verplicht', []) if v not in kaart]
            if ontbrekend_verplicht:
                log('    verplichte velden ontbreken: %s' % ', '.join(ontbrekend_verplicht))
                continue

            # Meest recente periode bepalen
            perioden = sorted({str(r.get(periodeveld) or '') for r in rijen if periodeveld}) if periodeveld else []
            laatste = perioden[-1] if perioden else None

            # Uitsplitsingskolommen: kies de totaalregel
            splitsveld = zoek_veld(kolommen, ['Woningkenmerken', 'Gebruiksfunctie', 'Kenmerken', 'Onderwerp'])

            perGemeente = {}
            aantal = 0
            for r in rijen:
                code = str(r.get(regioveld) or '').strip()
                if not code:
                    continue
                if cfg['niveau'] == 'buurt' and not code.startswith('BU'):
                    continue
                if cfg['niveau'] == 'gemeente' and not code.startswith('GM'):
                    continue
                if laatste and periodeveld and str(r.get(periodeveld) or '') != laatste:
                    continue
                if splitsveld:
                    sp = str(r.get(splitsveld) or '')
                    if sp and not re.match(r'^(T\d|totaal)', sp, re.I):
                        continue

                waarden = {}
                for veld, kolom in kaart.items():
                    v = r.get(kolom)
                    if v is None or v == '':
                        continue
                    try:
                        n = float(str(v).replace(',', '.'))
                    except ValueError:
                        waarden[veld] = v
                        continue
                    if n <= -99990:          # CBS-code voor onbekend
                        continue
                    waarden[veld] = round(n, 3) if n % 1 else int(n)
                if not waarden:
                    continue

                gm = gemeente_van(code)
                if not gm:
                    continue
                perGemeente.setdefault(gm, {})[code] = waarden
                aantal += 1

            if not aantal:
                log('    geen bruikbare rijen na filtering')
                continue

            log('    gelukt: %d gebieden in %d gemeenten, periode %s'
                % (aantal, len(perGemeente), laatste or '?'))
            if gemist:
                log('    niet gevonden velden: %s' % ', '.join(gemist))

            return {
                'tabel': tabel, 'host': host, 'niveau': cfg['niveau'],
                'periode': (laatste or '').replace('JJ00', '') or None,
                'velden_gevonden': sorted(kaart.keys()),
                'velden_gemist': sorted(gemist),
                'gebieden': aantal, 'gemeenten': len(perGemeente),
                '_data': perGemeente,
            }
    return None


def main():
    ap = argparse.ArgumentParser(description='CBS StatLine vooraf ophalen en valideren.')
    ap.add_argument('--uit', default='data/cbs', help='Uitvoermap (standaard data/cbs)')
    ap.add_argument('--onderwerp', action='append',
                    help='Beperk tot dit onderwerp (meerdere keren toegestaan)')
    ap.add_argument('--max', type=int, default=0, help='Maximaal aantal rijen per tabel (test)')
    ap.add_argument('--strict', action='store_true',
                    help='Exitcode 1 zodra een onderwerp niet lukt')
    ap.add_argument('--dryrun', action='store_true', help='Niets wegschrijven')
    args = ap.parse_args()

    namen = args.onderwerp or list(ONDERWERPEN.keys())
    onbekend = [n for n in namen if n not in ONDERWERPEN]
    if onbekend:
        raise SystemExit('Onbekend onderwerp: %s' % ', '.join(onbekend))

    manifest = {
        'gegenereerd': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'bron': 'CBS StatLine open data (opendata.cbs.nl)',
        'onderwerpen': {},
        'mislukt': [],
    }

    if not args.dryrun:
        os.makedirs(args.uit, exist_ok=True)

    gelukt = 0
    for naam in namen:
        log('\n%s (%s)' % (naam, ONDERWERPEN[naam]['titel']))
        res = verwerk_onderwerp(naam, ONDERWERPEN[naam], args.max)
        if not res:
            log('  MISLUKT — geen bruikbare tabel gevonden')
            manifest['mislukt'].append(naam)
            continue

        gelukt += 1
        data = res.pop('_data')
        manifest['onderwerpen'][naam] = res

        if args.dryrun:
            continue
        map_ = os.path.join(args.uit, naam)
        os.makedirs(map_, exist_ok=True)
        for gm, inhoud in data.items():
            with io.open(os.path.join(map_, gm + '.json'), 'w', encoding='utf-8') as f:
                json.dump(inhoud, f, ensure_ascii=False, separators=(',', ':'))

    if not args.dryrun:
        with io.open(os.path.join(args.uit, 'manifest.json'), 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)

    log('\n' + '=' * 60)
    log('Gelukt : %d van %d' % (gelukt, len(namen)))
    if manifest['mislukt']:
        log('Mislukt: %s' % ', '.join(manifest['mislukt']))
        log('\nCBS hernummert tabellen regelmatig. Zoek het nieuwe nummer op')
        log('https://opendata.cbs.nl/statline en vul het bij ONDERWERPEN in dit')
        log('script aan, en in het STATLINE-register in index.html.')

    if gelukt == 0:
        return 2
    if manifest['mislukt'] and args.strict:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
