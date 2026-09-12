#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Schrijft een leesbare samenvatting van data/cbs/manifest.json, bedoeld voor
de stapsamenvatting van GitHub Actions. Zo is in één oogopslag te zien welke
tabel is gebruikt en of CBS een kolomnaam heeft gewijzigd."""
import io
import json
import os

MANIFEST = 'data/cbs/manifest.json'

print('## CBS StatLine-momentopname\n')

if not os.path.exists(MANIFEST):
    print('Geen manifest geschreven. Zie het logbestand van de vorige stap.')
    raise SystemExit(0)

m = json.load(io.open(MANIFEST, encoding='utf-8'))
print('Gegenereerd: `%s`\n' % m.get('gegenereerd', '?'))

ond = m.get('onderwerpen', {})
if ond:
    print('| Onderwerp | Tabel | Periode | Gebieden | Velden gemist |')
    print('|---|---|---|---:|---|')
    for naam, o in ond.items():
        gemist = o.get('velden_gemist') or []
        print('| %s | `%s` | %s | %s | %s |' % (
            naam, o.get('tabel', '?'), o.get('periode') or '?',
            o.get('gebieden', 0),
            ', '.join('`%s`' % g for g in gemist) if gemist else '—'))
    print('')

mislukt = m.get('mislukt') or []
if mislukt:
    print('### Niet opgehaald\n')
    print('**%s**\n' % ', '.join(mislukt))
    print('CBS hernummert tabellen regelmatig. Zoek het nieuwe tabelnummer op')
    print('<https://opendata.cbs.nl/statline>, vul het aan bij `ONDERWERPEN` in')
    print('`scripts/fetch_statline.py`, en werk het `STATLINE`-register in')
    print('`index.html` bij. De controle-workflow vergelijkt die twee.\n')
else:
    print('Alle onderwerpen opgehaald.\n')

# Een weggevallen veld is geen fout maar wel een signaal
totaal_gemist = sum(len(o.get('velden_gemist') or []) for o in ond.values())
if totaal_gemist:
    print('> %d veld(en) niet gevonden. De tool laat die simpelweg weg, maar'
          % totaal_gemist)
    print('> controleer of CBS de kolomnaam heeft gewijzigd.')
