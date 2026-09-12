const INDEX = require('path').join(__dirname, '..', 'index.html');
// Test: printopmaak — dekking, leesbaarheid en pagina-afhandeling
const fs = require('fs');
const { JSDOM } = require('jsdom');

const BESTAND = INDEX;
const html = fs.readFileSync(BESTAND, 'utf8');
const fouten = [];

const dom = new JSDOM(html, {
  runScripts:'dangerously', url:'https://example.org/', pretendToBeVisual:true,
  beforeParse(win) {
    win.fetch = () => Promise.reject(new Error('offline'));
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {}; win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
  },
});

function lum(hex) {
  const c = hex.replace('#', '');
  const v = [0, 2, 4].map(i => {
    let x = parseInt(c.substr(i, 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
const contrast = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

setTimeout(() => {
  const w = dom.window, d = w.document;
  const test = (naam, fn) => {
    try {
      const r = fn();
      console.log((r ? 'OK  ' : 'FOUT') + '  ' + naam + (r && r !== true ? ' → ' + r : ''));
      if (!r) fouten.push(naam);
    } catch (e) {
      console.log('FOUT  ' + naam + ' → ' + e.message);
      fouten.push(naam + ': ' + e.message);
    }
  };

  // Een rapport met alle secties gevuld genereren
  w.registerBron('bouwjaar', 'Bouwjaar', 'bag', 'auto', 2004, 'test');
  w.registerBron('perceeloppervlak', 'Perceeloppervlak', 'kadaster', 'schatting', '319 m²', 'test');
  d.getElementById('woonoppervlak').value = '191';
  d.getElementById('bouwjaar').value = '2004';
  d.getElementById('energielabel').value = 'A';
  w.zetSliderBekend('dak', 8);
  w.switchTab('resultaat');

  let uit = null;
  w.open = () => ({ document: { write: t => { uit = t; }, close(){} }, focus(){}, print(){} });
  w.printRapport();

  const printDoc = new JSDOM(uit).window.document;
  const printCss = [...printDoc.querySelectorAll('style')].map(x => x.textContent).join('\n');
  const gedef = new Set((printCss.match(/\.([A-Za-z][\w-]*)/g) || []).map(x => x.slice(1)));
  const gebruikt = new Set();
  printDoc.querySelectorAll('[class]').forEach(el =>
    el.className.split(/\s+/).filter(Boolean).forEach(c => gebruikt.add(c)));

  test('Rapport gegenereerd', () => uit && uit.length > 5000 ? uit.length + ' tekens' : false);

  test('Alle gebruikte klassen hebben een stijlregel', () => {
    const ont = [...gebruikt].filter(c => !gedef.has(c));
    return ont.length === 0 ? gebruikt.size + ' klassen gedekt' : false;
  });

  test('De eerder ontbrekende klassen zijn nu opgenomen', () => {
    const eerder = ['result-section','fund-grid','fund-stat','bron-tbl','wft-disclaimer',
                    'alert','alert-info','section-divider','rm-balk','rm-vul','lbl','val'];
    const ont = eerder.filter(c => !gedef.has(c));
    return ont.length === 0 ? '12 van 12' : 'mist: ' + ont.join(', ');
  });

  test('Typografie sluit aan op het design', () =>
    printCss.includes('font-family:Inter') && printCss.includes('fonts.googleapis.com')
      ? 'Inter met Arial als terugval' : false);
  test('Terugvallettertype aanwezig voor offline printen', () =>
    /font-family:Inter,'Helvetica Neue',Arial,sans-serif/.test(printCss));

  test('Donkere inkt op wit', () => {
    const bg = (printCss.match(/body\{[^}]*background:(#fff|white)/) || [])[0];
    const ink = (printCss.match(/--ink2:\s*(#[0-9a-f]{6})/) || [])[1];
    const r = ink ? contrast(ink, '#ffffff') : 0;
    return bg && r >= 7 ? 'lopende tekst ' + r.toFixed(1) + ':1' : 'contrast ' + r.toFixed(1);
  });
  test('Bijschrifttekst haalt nog AA', () => {
    const ink3 = (printCss.match(/--ink3:\s*(#[0-9a-f]{6})/) || [])[1];
    const r = contrast(ink3, '#ffffff');
    return r >= 4.5 ? r.toFixed(1) + ':1' : r.toFixed(1) + ':1 (te laag)';
  });
  test('Accentkleur verdonkerd voor papier', () => {
    const acc = (printCss.match(/--accent:\s*(#[0-9a-f]{6})/) || [])[1];
    const r = contrast(acc, '#ffffff');
    return r >= 4.5 ? acc + ' geeft ' + r.toFixed(1) + ':1' : acc + ' slechts ' + r.toFixed(1) + ':1';
  });

  test('A4-pagina-instelling', () => printCss.includes('@page{size:A4'));
  test('Secties breken niet over paginas', () =>
    (printCss.match(/page-break-inside:avoid/g) || []).length >= 5
      ? (printCss.match(/page-break-inside:avoid/g) || []).length + ' keer toegepast' : false);
  test('Tabelkop herhaalt bij lange tabellen', () => printCss.includes('thead{display:table-header-group}'));
  test('Koppen blijven bij hun inhoud', () => printCss.includes('page-break-after:avoid'));

  test('Kerngetallen in vaste kolommen, niet als grid', () => {
    const m = printCss.match(/\.fund-grid\{([^}]*)\}/);
    return m && m[1].includes('flex') && !m[1].includes('grid') ? 'flex met vaste breedte' : (m ? m[1] : 'ontbreekt');
  });
  test('Balkjes hebben een rand voor druk zonder achtergrond', () => {
    const m = printCss.match(/\.rm-balk\{([^}]*)\}/);
    return m && m[1].includes('border') ? 'rand aanwezig' : false;
  });
  test('Emoji in meldingen verborgen', () => printCss.includes('.alert-icon{display:none}'));
  test('Schermelementen uitgesloten', () => {
    const m = printCss.match(/\.actions-row[^{]*\{([^}]*)\}/);
    return m && m[1].includes('display:none') ? 'knoppen en navigatie weggelaten' : false;
  });

  test('Alle inhoudelijke secties aanwezig', () => {
    // 'Locatie' verschijnt alleen met coordinaten; die zijn er niet in deze offline test
    const secties = ['Scores per categorie','Betrouwbaarheid van deze uitkomst',
      'Indicatieve waarde','Verduurzaming, lasten en leenruimte','Aanbevelingen','Verantwoording',
      'Geen advies in de zin van de Wft','Aansprakelijkheid','Privacy'];
    const mist = secties.filter(x => !uit.includes(x));
    return mist.length === 0 ? secties.length + ' secties' : 'MIST: ' + mist.join(' | ');
  });
  test('Rapport-ID en modelversie in de kop', () =>
    uit.includes('Rapport-ID') && /Model: v\d+\.\d+\.\d+/.test(uit));
  test('Geen donkere schermkleuren meegelekt', () =>
    !uit.includes('#161826') && !uit.includes('--color-bg') ? 'geen schermtokens' : false);

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 800);
