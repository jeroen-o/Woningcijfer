#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
epo_shard.py — EP-Online bulkexport omzetten naar een gesharde JSON-lookup.

Zet een bestand als v20260801_v4_csv.csv (circa 1,6 GB) om in ongeveer
4.000 kleine JSON-bestanden, één per PC4-gebied. De Woningcijfer-tool haalt
per adres alleen de shard van die postcode op — enkele honderden kB in plaats
van de hele dataset.

Gebruik:
    python3 epo_shard.py v20260801_v4_csv.csv --uit ./labels
    python3 epo_shard.py v20260801_v4_csv.csv --uit ./labels --peildatum 2026-08-01

Opties:
    --uit PAD          Uitvoermap (standaard ./labels)
    --peildatum DATUM  Peildatum voor meta.json; standaard afgeleid uit de
                       bestandsnaam (v20260801 -> 2026-08-01)
    --scheiding TEKEN  Forceer scheidingsteken; standaard automatisch
    --max N            Stop na N regels (om te testen op een steekproef)
    --toon-header      Alleen de gedetecteerde kolommen tonen en stoppen

Het script is geheugenzuinig: het streamt de invoer en schrijft eerst naar
tijdelijke JSONL-bestanden per PC4, die daarna worden gecomprimeerd tot JSON.
Er wordt nooit meer dan een buffer van enkele tienduizenden regels vastgehouden.

Vereist alleen de standaardbibliotheek van Python 3.8 of hoger.
"""

import argparse
import io
import json
import os
import re
import shutil
import sys
import time
from collections import defaultdict

# ── Kolomherkenning ────────────────────────────────────────────────────────
# De EP-Online export kent per versie licht afwijkende kolomnamen. In plaats
# van een vaste volgorde herkennen we de kolommen op naam, met varianten.
KOLOM_PATRONEN = {
    'postcode':    [r'^postcode$', r'^pand_postcode$', r'postcode'],
    'huisnummer':  [r'^huisnummer$', r'^pand_huisnummer$', r'huisnummer$'],
    'toevoeging':  [r'^huisnummer[_\s]*toevoeging$', r'^toevoeging$', r'toevoeging'],
    'huisletter':  [r'^huisletter$', r'huisletter'],
    'label':       [r'^labelletter$', r'^energieklasse$', r'^energielabel$',
                    r'^pand_energieklasse$', r'^klasse$', r'label.?letter', r'energieklasse'],
    'registratie': [r'^registratiedatum$', r'^opnamedatum$', r'^datum[_\s]*registratie$',
                    r'^pand_registratiedatum$', r'registratiedatum', r'opnamedatum'],
    'geldig_tot':  [r'^geldig[_\s]*tot$', r'^einddatum$', r'geldig.?tot'],
    'gebouwklasse':[r'^gebouwklasse$', r'^pand_gebouwklasse$', r'gebouwklasse'],
    'bagvbo':      [r'^bag[_\s]*verblijfsobject.*$', r'^pand_bagverblijfsobjectid$',
                    r'bagverblijfsobject', r'verblijfsobject.?id'],
}

SCHEIDINGSTEKENS = ['|', ';', '\t', ',']

# Geldige energieklassen, van best naar slechtst
GELDIGE_LABELS = ['A+++++', 'A++++', 'A+++', 'A++', 'A+',
                  'A', 'B', 'C', 'D', 'E', 'F', 'G']


def log(msg):
    sys.stderr.write(msg + '\n')
    sys.stderr.flush()


def detecteer_scheiding(headerregel):
    """Kies het scheidingsteken dat de meeste kolommen oplevert."""
    beste, beste_n = None, 0
    for sep in SCHEIDINGSTEKENS:
        n = len(headerregel.split(sep))
        if n > beste_n:
            beste, beste_n = sep, n
    if beste_n < 3:
        raise SystemExit('Kon het scheidingsteken niet bepalen. Gebruik --scheiding.')
    return beste


def normaliseer_kolomnaam(naam):
    return re.sub(r'[^a-z0-9]+', '', naam.strip().strip('"').strip("'").lower())


def map_kolommen(headers):
    """Koppel logische veldnamen aan kolomindexen op basis van de header."""
    genormaliseerd = [normaliseer_kolomnaam(h) for h in headers]
    gevonden = {}
    for veld, patronen in KOLOM_PATRONEN.items():
        for patroon in patronen:
            p = re.compile(re.sub(r'[_\s]\*', '', patroon.replace('[_\\s]*', '')), re.I)
            for i, kol in enumerate(genormaliseerd):
                if i in gevonden.values():
                    continue
                if p.search(kol):
                    gevonden[veld] = i
                    break
            if veld in gevonden:
                break
    return gevonden


def normaliseer_label(waarde):
    """Maak van de ruwe labelwaarde een geldige energieklasse of None."""
    if not waarde:
        return None
    w = waarde.strip().strip('"').upper().replace(' ', '')
    if not w:
        return None
    # Varianten als 'A++' of 'A2PLUS' of 'APLUSPLUS' opvangen
    m = re.match(r'^([A-G])(\+{0,5})$', w)
    if m:
        kandidaat = m.group(1) + m.group(2)
        return kandidaat if kandidaat in GELDIGE_LABELS else None
    m = re.match(r'^A(\d)PLUS$', w)
    if m:
        return 'A' + '+' * int(m.group(1))
    if w == 'APLUS':
        return 'A+'
    return w if w in GELDIGE_LABELS else None


def normaliseer_datum(waarde):
    """Geef de datum als YYYYMMDD, of lege string."""
    if not waarde:
        return ''
    w = waarde.strip().strip('"')
    m = re.search(r'(\d{4})-(\d{2})-(\d{2})', w)
    if m:
        return m.group(1) + m.group(2) + m.group(3)
    m = re.search(r'(\d{2})-(\d{2})-(\d{4})', w)
    if m:
        return m.group(3) + m.group(2) + m.group(1)
    m = re.search(r'^(\d{8})', w)
    if m:
        return m.group(1)
    return ''


def normaliseer_postcode(waarde):
    if not waarde:
        return None
    w = re.sub(r'[^0-9A-Za-z]', '', waarde).upper()
    if re.match(r'^\d{4}[A-Z]{2}$', w):
        return w
    return None


def normaliseer_toevoeging(*delen):
    """Huisletter en toevoeging samenvoegen tot één genormaliseerde sleutel."""
    samen = ''.join(d.strip().strip('"') for d in delen if d)
    return re.sub(r'[^0-9A-Za-z]', '', samen).upper()


def peildatum_uit_naam(pad):
    m = re.search(r'v(\d{4})(\d{2})(\d{2})', os.path.basename(pad))
    if m:
        return '%s-%s-%s' % (m.group(1), m.group(2), m.group(3))
    return time.strftime('%Y-%m-%d')


def main():
    ap = argparse.ArgumentParser(description='EP-Online bulkexport omzetten naar gesharde JSON.')
    ap.add_argument('csv', help='Pad naar de EP-Online CSV (bijv. v20260801_v4_csv.csv)')
    ap.add_argument('--uit', default='./labels', help='Uitvoermap (standaard ./labels)')
    ap.add_argument('--peildatum', default=None, help='Peildatum, bijv. 2026-08-01')
    ap.add_argument('--scheiding', default=None, help='Forceer scheidingsteken')
    ap.add_argument('--max', type=int, default=0, help='Stop na N regels (test)')
    ap.add_argument('--toon-header', action='store_true', help='Alleen kolomherkenning tonen')
    args = ap.parse_args()

    if not os.path.isfile(args.csv):
        raise SystemExit('Bestand niet gevonden: ' + args.csv)

    bestandsgrootte = os.path.getsize(args.csv)
    peildatum = args.peildatum or peildatum_uit_naam(args.csv)

    # ── Header lezen ──
    with io.open(args.csv, 'r', encoding='utf-8-sig', errors='replace', newline='') as f:
        headerregel = f.readline().rstrip('\r\n')
    sep = args.scheiding or detecteer_scheiding(headerregel)
    headers = headerregel.split(sep)
    kolommen = map_kolommen(headers)

    log('Bestand      : %s (%.2f GB)' % (args.csv, bestandsgrootte / 1e9))
    log('Scheiding    : %r' % sep)
    log('Kolommen     : %d' % len(headers))
    log('Peildatum    : %s' % peildatum)
    log('')
    log('Herkende velden:')
    for veld in ['postcode', 'huisnummer', 'huisletter', 'toevoeging', 'label',
                 'registratie', 'geldig_tot', 'gebouwklasse', 'bagvbo']:
        idx = kolommen.get(veld)
        naam = headers[idx].strip().strip('"') if idx is not None else '— niet gevonden —'
        log('  %-13s %s' % (veld + ':', naam))
    log('')

    ontbreekt = [v for v in ('postcode', 'huisnummer', 'label') if v not in kolommen]
    if ontbreekt:
        log('FOUT: verplichte kolommen niet herkend: ' + ', '.join(ontbreekt))
        log('Alle kolomnamen in de header:')
        for i, h in enumerate(headers):
            log('  [%d] %s' % (i, h.strip().strip('"')))
        log('')
        log('Vul de juiste namen aan in KOLOM_PATRONEN bovenin dit script en draai opnieuw.')
        raise SystemExit(2)

    if args.toon_header:
        return

    i_pc = kolommen['postcode']
    i_hn = kolommen['huisnummer']
    i_lb = kolommen['label']
    i_hl = kolommen.get('huisletter')
    i_tv = kolommen.get('toevoeging')
    i_rd = kolommen.get('registratie')
    max_idx = max(x for x in kolommen.values() if x is not None)

    # ── Fase 1: streamen naar tijdelijke JSONL per PC4 ──
    tmpdir = os.path.join(args.uit, '_tmp')
    if os.path.isdir(tmpdir):
        shutil.rmtree(tmpdir)
    os.makedirs(tmpdir, exist_ok=True)

    buffers = defaultdict(list)
    gebufferd = 0
    BUFFER_MAX = 200000

    def flush():
        nonlocal gebufferd
        for pc4, regels in buffers.items():
            with io.open(os.path.join(tmpdir, pc4 + '.jsonl'), 'a', encoding='utf-8') as fh:
                fh.write('\n'.join(regels) + '\n')
        buffers.clear()
        gebufferd = 0

    gelezen = geldig = overgeslagen = 0
    start = time.time()

    with io.open(args.csv, 'r', encoding='utf-8-sig', errors='replace', newline='') as f:
        f.readline()  # header
        for regel in f:
            gelezen += 1
            if args.max and gelezen > args.max:
                break

            velden = regel.rstrip('\r\n').split(sep)
            if len(velden) <= max_idx:
                overgeslagen += 1
                continue

            pc = normaliseer_postcode(velden[i_pc])
            if not pc:
                overgeslagen += 1
                continue

            hn = re.sub(r'[^0-9]', '', velden[i_hn].strip().strip('"'))
            if not hn:
                overgeslagen += 1
                continue

            label = normaliseer_label(velden[i_lb])
            if not label:
                overgeslagen += 1
                continue

            toev = normaliseer_toevoeging(
                velden[i_hl] if i_hl is not None else '',
                velden[i_tv] if i_tv is not None else '')
            datum = normaliseer_datum(velden[i_rd]) if i_rd is not None else ''

            sleutel = pc[4:] + hn + toev            # bijv. 'JS1' of 'JS1A'
            buffers[pc[:4]].append(json.dumps([sleutel, label, datum], ensure_ascii=False))
            gebufferd += 1
            geldig += 1

            if gebufferd >= BUFFER_MAX:
                flush()
                verstreken = time.time() - start
                log('  %s regels verwerkt, %s bruikbaar (%.0f regels/s)'
                    % (format(gelezen, ',d').replace(',', '.'),
                       format(geldig, ',d').replace(',', '.'),
                       gelezen / max(verstreken, 0.001)))
    flush()

    log('')
    log('Fase 1 klaar: %s regels gelezen, %s bruikbaar, %s overgeslagen.'
        % (format(gelezen, ',d').replace(',', '.'),
           format(geldig, ',d').replace(',', '.'),
           format(overgeslagen, ',d').replace(',', '.')))

    # ── Fase 2: per PC4 comprimeren tot één JSON ──
    log('Fase 2: shards samenstellen…')
    shards = 0
    adressen = 0
    labelverdeling = defaultdict(int)

    for naam in sorted(os.listdir(tmpdir)):
        if not naam.endswith('.jsonl'):
            continue
        pc4 = naam[:-6]
        beste = {}
        with io.open(os.path.join(tmpdir, naam), 'r', encoding='utf-8') as fh:
            for r in fh:
                r = r.strip()
                if not r:
                    continue
                sleutel, label, datum = json.loads(r)
                # Meest recente registratie wint bij dubbele adressen
                huidig = beste.get(sleutel)
                if huidig is None or datum > huidig[1]:
                    beste[sleutel] = (label, datum)

        uit = {k: (v[0] if not v[1] else v[0] + '|' + v[1]) for k, v in beste.items()}
        with io.open(os.path.join(args.uit, pc4 + '.json'), 'w', encoding='utf-8') as fh:
            json.dump(uit, fh, ensure_ascii=False, separators=(',', ':'))

        shards += 1
        adressen += len(uit)
        for v in beste.values():
            labelverdeling[v[0]] += 1

    shutil.rmtree(tmpdir)

    # ── Meta-bestand ──
    meta = {
        'bron': 'EP-Online bulkexport (RVO)',
        'bronbestand': os.path.basename(args.csv),
        'peildatum': peildatum,
        'gegenereerd': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'aantal_adressen': adressen,
        'aantal_shards': shards,
        'sleutelformaat': 'PC4-bestand; sleutel = 2 postcodeletters + huisnummer + toevoeging, bijv. JS1A',
        'waardeformaat': 'energieklasse of energieklasse|YYYYMMDD (registratiedatum)',
        'labelverdeling': dict(sorted(labelverdeling.items(),
                                      key=lambda x: GELDIGE_LABELS.index(x[0])
                                      if x[0] in GELDIGE_LABELS else 99)),
    }
    with io.open(os.path.join(args.uit, 'meta.json'), 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)

    totaal_mb = sum(os.path.getsize(os.path.join(args.uit, f))
                    for f in os.listdir(args.uit) if f.endswith('.json')) / 1e6

    log('')
    log('Klaar.')
    log('  Shards        : %d' % shards)
    log('  Adressen      : %s' % format(adressen, ',d').replace(',', '.'))
    log('  Totale omvang : %.1f MB (gemiddeld %.0f kB per shard)'
        % (totaal_mb, totaal_mb * 1000 / max(shards, 1)))
    log('  Uitvoermap    : %s' % os.path.abspath(args.uit))
    log('')
    log('Labelverdeling:')
    for k, v in meta['labelverdeling'].items():
        log('  %-7s %s' % (k, format(v, ',d').replace(',', '.')))
    log('')
    log('Zet de map met JSON-bestanden op een webserver en vul de URL in bij')
    log('LABEL_LOOKUP in woningcijfer-v2.html (of geef ?labels=<url> mee in de link).')


if __name__ == '__main__':
    main()
