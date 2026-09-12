// Test: gebiedscontrole op StatLine en leesbaarheid van de detailscoretabel
const INDEX = require('path').join(__dirname, '..', 'index.html');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const fouten = [];

// Nijkerkerveen: Laakweg 62, gemeente Nijkerk = GM0267
const GM = 'GM0267';
const BU = 'BU02670503';

// De landelijke prognosetabel heeft geen gemeentekolom. Sommige diensten
// negeren dan het filter en geven de hele tabel terug — precies de situatie
// die het cijfer voor heel Nederland onder 'gemeente' zette.
// Tabel zonder gebiedskolom: sommige diensten negeren dan het filter en
// geven de hele tabel terug — precies wat het landelijke cijfer onder het
// kopje 'gemeente' zette.
const landelijk = { value: [
  { ID: 0, Perioden: '2070JJ00', GemiddeldeVerkoopprijs_2: 20599185 },
  { ID: 1, Perioden: '2030JJ00', GemiddeldeVerkoopprijs_2: 18300000 },
]};

const regionaal = { value: [
  { ID: 0, RegioS: 'GM0267', Perioden: '2024JJ00', GemiddeldeVerkoopprijs_2: 452000 },
  { ID: 1, RegioS: 'GM0273', Perioden: '2024JJ00', GemiddeldeVerkoopprijs_2: 62000 },
  { ID: 2, RegioS: 'NL01',   Perioden: '2024JJ00', GemiddeldeVerkoopprijs_2: 18800000 },
]};

// Tabel die het filter respecteert maar een buurgemeente teruggeeft
const verkeerdGebied = { value: [
  { ID: 0, RegioS: 'GM0273', Perioden: '2024JJ00', GemiddeldeVerkoopprijs_2: 452000 },
]};

let scenario = 'regionaal';

const dom = new JSDOM(html, {
  runScripts:'dangerously', url:'https://example.org/', pretendToBeVisual:true,
  beforeParse(win) {
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {}; win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
    win.fetch = (url) => {
      const u = decodeURIComponent(String(url));
      const ok = o => Promise.resolve({ ok:true, json:() => Promise.resolve(o) });
      if (u.includes('TypedDataSet')) {
        if (scenario === 'landelijk') return ok(landelijk);
        if (scenario === 'verkeerd') return ok(verkeerdGebied);
        return ok(regionaal);
      }
      if (u.includes('manifest.json')) return Promise.resolve({ ok:false, status:404 });
      return Promise.reject(new Error('geen netwerk'));
    };
  },
});

setTimeout(async () => {
  const w = dom.window, d = w.document;
  const test = async (naam, fn) => {
    try {
      const r = await fn();
      console.log((r ? 'OK  ' : 'FOUT') + '  ' + naam + (r && r !== true ? ' → ' + r : ''));
      if (!r) fouten.push(naam);
    } catch (e) {
      console.log('FOUT  ' + naam + ' → ' + e.message);
      fouten.push(naam + ': ' + e.message);
    }
  };
  const css = [...d.querySelectorAll('style')].map(x => x.textContent).join('\n');

  // ── Gebiedscontrole ──
  await test('Landelijke tabel zonder gemeentekolom wordt geweigerd', async () => {
    scenario = 'landelijk';
    const r = await w.haalStatline('verkoop', BU, GM);
    scenario = 'regionaal';
    return r === null ? 'null — geen 20.599.185 meer onder "gemeente"' : JSON.stringify(r).slice(0, 90);
  });
  await test('Rij van een andere gemeente wordt geweigerd', async () => {
    scenario = 'verkeerd';
    const r = await w.haalStatline('verkoop', BU, GM);
    scenario = 'regionaal';
    return r === null ? 'GM0273 niet geaccepteerd voor GM0267' : JSON.stringify(r).slice(0, 90);
  });
  await test('Prognose-onderwerp is verwijderd', () =>
    !html.includes("titel: 'Regionale bevolkingsprognose'")
      ? 'niet meer in het register' : 'staat er nog');
  await test('Juiste gemeente wordt wel gebruikt', async () => {
    const r = await w.haalStatline('verkoop', BU, GM);
    return r && r.gemiddeldePrijs === 452000 ? '€ 452.000 voor Nijkerk' : JSON.stringify(r).slice(0, 90);
  });
  await test('Landelijke rij in een regionale tabel overgeslagen', async () => {
    const r = await w.haalStatline('verkoop', BU, GM);
    return r && r.gemiddeldePrijs !== 18800000 ? 'NL01 genegeerd' : 'landelijk cijfer gebruikt';
  });
  await test('Buurgemeente in dezelfde tabel overgeslagen', async () => {
    const r = await w.haalStatline('verkoop', BU, GM);
    return r && r.gemiddeldePrijs !== 62000 ? 'GM0273 genegeerd' : 'buurgemeente gebruikt';
  });

  await test('Gebiedskolom herkend ongeacht de naam', () => {
    return w.regioKolomVan({ WijkenEnBuurten: BU }) === 'WijkenEnBuurten'
      && w.regioKolomVan({ RegioS: GM }) === 'RegioS'
      && w.regioKolomVan({ Perioden: '2024' }) === null ? 'drie varianten' : false;
  });
  await test('Rij zonder gebiedskolom geldt als onverifieerbaar', () =>
    w.rijHoortBijGebied({ Perioden: '2070JJ00', TotaleBevolking_1: 20599185 }, GM) === false
      ? 'geweigerd' : false);
  await test('Spatiepadding in de code opgevangen', () =>
    w.rijHoortBijGebied({ RegioS: 'GM0267  ' }, 'GM0267') === true);

  await test('Landelijke prognosetabellen niet meer in gebruik', () =>
    !html.includes("'84528NED'") && !html.includes("'85089NED'")
      ? 'geen prognosetabellen meer' : 'staan er nog');

  // ── Leesbaarheid van de tabel ──
  await test('Geen witte rijachtergrond meer in de template', () =>
    !html.includes("?'var(--color-surface)':'white'") ? 'inline zebra verwijderd' : 'staat er nog');
  await test('Zebra staat in de stylesheet', () =>
    css.includes('.score-tbl tbody tr:nth-child(odd)') && css.includes('.score-tbl tbody tr:nth-child(even)')
      ? 'via nth-child' : false);
  await test('Zebra gebruikt designtokens', () => {
    const m = css.match(/\.score-tbl tbody tr:nth-child\(odd\)\s*\{([^}]*)\}/);
    return m && m[1].includes('var(--color-surface)') && !m[1].includes('white')
      ? 'var(--color-surface) en transparant' : (m ? m[1] : 'ontbreekt');
  });
  await test('Scorelabel heeft donkere tekst op de kleurvlek', () => {
    const m = css.match(/\.score-pil\s*\{([^}]*)\}/);
    return m && /color:\s*#14161f/.test(m[1]) ? 'donkere inkt op de pil' : (m ? m[1] : 'ontbreekt');
  });
  await test('Tabel rendert met de nieuwe klassen', () => {
    w.switchTab('resultaat');
    const h = d.getElementById('resultaat-panel').innerHTML;
    return h.includes('class="score-tbl"') && h.includes('class="totaal"')
      && !h.includes(":'white'") ? 'score-tbl in gebruik' : false;
  });
  await test('Tabel schuift horizontaal op smalle schermen', () => {
    const h = d.getElementById('resultaat-panel').innerHTML;
    const i = h.indexOf('score-tbl');
    return h.slice(Math.max(0, i - 120), i).includes('overflow-x:auto') ? 'in een scrollbare houder' : false;
  });
  await test('Alle zes categorieen in de tabel', () => {
    const h = d.getElementById('resultaat-panel').innerHTML;
    const n = ['Bouwkundige staat','Grond &amp; juridisch','Omgeving &amp; hinder','Voorzieningen',
               'Levensloopbestendigheid','Energie'].filter(x => h.includes(x)).length;
    return n === 6 ? '6 categorieen' : false;
  });

  // ── Printrapport ──
  await test('Printtabel zonder hardgecodeerde lichte kleuren', () =>
    !html.includes("?'#F4F7F9':'white'") && !html.includes('background:#003057;color:white')
      ? 'opgeruimd' : 'staat er nog');
  await test('Printtotaalrij heeft een eigen stijlregel', () => {
    return html.includes('.totaalrij td{') && html.includes('class="totaalrij"')
      ? 'stijlregel en gebruik aanwezig' : false;
  });

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 800);
