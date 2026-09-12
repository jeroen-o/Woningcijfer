#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
validate_html.py — structurele controles op index.html.

Dit vangt de fouten die in dit project daadwerkelijk zijn voorgekomen en die
een browser niet meldt: een klassenaam zonder stijlregel, een host die in de
code wordt aangeroepen maar niet in de Content-Security-Policy staat, en een
printstylesheet dat achterloopt op de secties die erin worden gegoten.

Gebruik:
    python3 scripts/validate_html.py index.html
    python3 scripts/validate_html.py index.html --waarschuwing-is-fout

Exitcode 1 bij een fout.
"""

import argparse
import io
import re
import sys

fouten = []
waarschuwingen = []


def fout(m):
    fouten.append(m)
    print('FOUT  ' + m)


def waarschuw(m):
    waarschuwingen.append(m)
    print('LET OP ' + m)


def ok(m):
    print('ok    ' + m)


def stylesheets(html):
    return re.findall(r'<style[^>]*>(.*?)</style>', html, re.S)


def klassen_in_css(css):
    return set(re.findall(r'\.([A-Za-z][\w-]*)', css))


def klassen_in_document(html):
    gebruikt = set()
    for m in re.finditer(r'class="([^"]*)"', html):
        waarde = m.group(1)
        if '${' in waarde:
            # Template-expressie: alleen de letterlijke delen meenemen
            waarde = re.sub(r'\$\{[^}]*\}', ' ', waarde)
        for c in waarde.split():
            if c and not c.startswith('$'):
                gebruikt.add(c)
    for m in re.finditer(r"classList\.(?:add|toggle|remove)\('([\w-]+)'", html):
        gebruikt.add(m.group(1))
    for m in re.finditer(r"className\s*=\s*'([^'$]+)'", html):
        for c in m.group(1).split():
            gebruikt.add(c)
    return gebruikt


def controleer_schermstijlen(html):
    css = '\n'.join(stylesheets(html))
    gedef = klassen_in_css(css)
    gebruikt = klassen_in_document(html)
    ontbreekt = sorted(c for c in gebruikt if c not in gedef)
    if ontbreekt:
        fout('klassen zonder stijlregel op het scherm: %s' % ', '.join(ontbreekt))
    else:
        ok('alle %d klassen hebben een stijlregel' % len(gebruikt))


def printblad(html):
    i = html.find('function printRapport()')
    if i < 0:
        return None, None
    eind = html.find('\n}', html.find('w.document.close()', i))
    blok = html[i:eind if eind > 0 else i + 20000]
    m = re.search(r'<style>(.*?)</style>', blok, re.S)
    return blok, (m.group(1) if m else None)


def controleer_printblad(html):
    blok, css = printblad(html)
    if not css:
        fout('geen eigen stylesheet gevonden in printRapport()')
        return
    gedef = klassen_in_css(css)
    # Welke klassen komen er via de ingevoegde secties in het rapport terecht?
    gebruikt = set()
    for fn in ['waardeHTML', 'wozHTML', 'verduurzamingHTML', 'inkomenHTML',
               'nabijheidHTML', 'energieBuurtHTML', 'marktHTML', 'regiometerHTML',
               'misdrijvenHTML', 'scholenHTML', 'buurtstatHTML', 'bodemZonHTML',
               'prognoseHTML', 'kaartHTML']:
        j = html.find('function ' + fn)
        if j < 0:
            continue
        deel = html[j:html.find('\n}', j)]
        for m in re.finditer(r'class="([^"]*)"', deel):
            w = re.sub(r'\$\{[^}]*\}', ' ', m.group(1))
            for c in w.split():
                if c and not c.startswith('$'):
                    gebruikt.add(c)
    ontbreekt = sorted(c for c in gebruikt if c not in gedef)
    if ontbreekt:
        fout('klassen zonder stijlregel in het printblad: %s' % ', '.join(ontbreekt))
    else:
        ok('printblad dekt alle %d ingevoegde klassen' % len(gebruikt))

    if 'background:white' not in css and 'background:#fff' not in css:
        waarschuw('printblad zet geen witte achtergrond; controleer de inktkosten')
    else:
        ok('printblad is licht van opzet')
    if '@page' not in css:
        waarschuw('printblad zonder @page-regel; paginamarges zijn dan browserafhankelijk')
    else:
        ok('printblad heeft een @page-instelling')


def controleer_csp(html):
    m = re.search(r'Content-Security-Policy"\s*content="(.*?)"', html, re.S)
    if not m:
        fout('geen Content-Security-Policy gevonden')
        return
    csp = m.group(1)
    toegestaan = set(re.findall(r'https://([a-z0-9.-]+)', csp))

    # Welke hosts roept de code daadwerkelijk aan?
    aangeroepen = set()
    for m2 in re.finditer(r"""['"`]https://([a-z0-9.-]+)""", html):
        aangeroepen.add(m2.group(1))
    # Alleen hosts waar echt naartoe wordt gefetcht of die als bron dienen
    relevant = {h for h in aangeroepen
                if re.search(r"(fetch|haalJSON|haal\()\s*\(?\s*['\"`]?[^'\"`]*" + re.escape(h), html)}

    mist = sorted(h for h in relevant if h not in toegestaan)
    if mist:
        fout('hosts worden aangeroepen maar staan niet in de CSP: %s' % ', '.join(mist))
    else:
        ok('elke aangeroepen host staat in de CSP')

    if 'labels.example.nl' in csp:
        waarschuw('de voorbeeldhost labels.example.nl staat nog in de CSP; '
                  'vervang die door uw eigen host of verwijder de regel')
    if 'frame-ancestors' not in csp:
        waarschuw('geen frame-ancestors; embedden in Google Sites werkt dan mogelijk niet')
    else:
        ok('frame-ancestors aanwezig voor embedden')


def controleer_opslag(html):
    treffers = re.findall(r'\b(localStorage|sessionStorage|indexedDB)\b', html)
    if treffers:
        fout('browseropslag in gebruik (%s); dat is in deze tool uitgesloten'
             % ', '.join(sorted(set(treffers))))
    else:
        ok('geen browseropslag in gebruik')


def controleer_statline_register(html, scriptpad):
    """De onderwerpsnamen in de tool en in fetch_statline.py moeten gelijk zijn,
    anders schrijft de workflow bestanden weg die de tool nooit opvraagt."""
    m = re.search(r'const STATLINE = \{(.*?)\n\};', html, re.S)
    if not m:
        waarschuw('STATLINE-register niet gevonden in de HTML')
        return
    in_html = set(re.findall(r'^\s{2}(\w+):\s*\{', m.group(1), re.M))
    try:
        script = io.open(scriptpad, encoding='utf-8').read()
    except OSError:
        waarschuw('fetch_statline.py niet gevonden; register niet vergeleken')
        return
    m2 = re.search(r'ONDERWERPEN = \{(.*?)\n\}\n', script, re.S)
    in_py = set(re.findall(r"^\s{4}'(\w+)':\s*\{", m2.group(1), re.M)) if m2 else set()
    alleen_html = sorted(in_html - in_py)
    alleen_py = sorted(in_py - in_html)
    if alleen_html or alleen_py:
        fout('STATLINE-register loopt uiteen — alleen in HTML: %s; alleen in script: %s'
             % (alleen_html or 'geen', alleen_py or 'geen'))
    else:
        ok('STATLINE-register gelijk in tool en script (%d onderwerpen)' % len(in_html))


def controleer_modelversie(html):
    m = re.search(r"MODEL_VERSIE\s*=\s*'([^']+)'", html)
    d = re.search(r"MODEL_DATUM\s*=\s*'([^']+)'", html)
    if not m or not d:
        fout('MODEL_VERSIE of MODEL_DATUM ontbreekt; rapporten zijn dan niet herleidbaar')
        return
    ok('modelversie %s van %s' % (m.group(1), d.group(1)))


def controleer_wft(html):
    verplicht = [
        'Geen advies in de zin van de Wft',
        'nadrukkelijk geen taxatie',
        'geen hypotheekadvies',
        'Algemene wet gelijke behandeling',
        'aangiftebereidheid',
    ]
    mist = [t for t in verplicht if t not in html]
    if mist:
        fout('verplichte voorbehouden ontbreken: %s' % '; '.join(mist))
    else:
        ok('alle %d compliance-voorbehouden aanwezig' % len(verplicht))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('bestand', nargs='?', default='index.html')
    ap.add_argument('--statline-script', default='scripts/fetch_statline.py')
    ap.add_argument('--waarschuwing-is-fout', action='store_true')
    args = ap.parse_args()

    html = io.open(args.bestand, encoding='utf-8').read()
    print('Controle van %s (%.0f kB)\n' % (args.bestand, len(html) / 1024))

    controleer_schermstijlen(html)
    controleer_printblad(html)
    controleer_csp(html)
    controleer_opslag(html)
    controleer_statline_register(html, args.statline_script)
    controleer_modelversie(html)
    controleer_wft(html)

    print('\n%d fouten, %d waarschuwingen' % (len(fouten), len(waarschuwingen)))
    if fouten:
        return 1
    if waarschuwingen and args.waarschuwing_is_fout:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
