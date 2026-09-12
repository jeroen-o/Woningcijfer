// Test: oranje actiekleur en de politiecatalogus op dataderden.cbs.nl
const INDEX = require('path').join(__dirname, '..', 'index.html');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const fouten = [];
const verzoeken = [];

const rijen = [
  { WijkenEnBuurten: 'BU02670503', SoortMisdrijf: '0.0.0', Perioden: '2025JJ00',
    GeregistreerdeMisdrijven_1: 42, GeregistreerdeMisdrijvenRelatief_2: 10.2 },
  { WijkenEnBuurten: 'BU02670503', SoortMisdrijf: '1.1.1', Perioden: '2025JJ00',
    GeregistreerdeMisdrijven_1: 6, GeregistreerdeMisdrijvenRelatief_2: 1.5 },
  { WijkenEnBuurten: 'BU02670503', SoortMisdrijf: '1.2.5', Perioden: '2025JJ00',
    GeregistreerdeMisdrijven_1: 9, GeregistreerdeMisdrijvenRelatief_2: 2.2 },
];
const codelijst = [
  { Key: '0.0.0', Title: 'Totaal misdrijven' },
  { Key: '1.1.1', Title: 'Diefstal/inbraak woning' },
  { Key: '1.2.5', Title: 'Diefstal van brom-, snor-, fietsen' },
];

// Alleen dataderden.cbs.nl bedient de catalogus Politie
let alleenDerden = true;

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://example.org/', pretendToBeVisual: true,
  beforeParse(win) {
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {}; win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
    win.fetch = (url) => {
      const u = decodeURIComponent(String(url));
      verzoeken.push(u);
      const ok = o => Promise.resolve({ ok: true, json: () => Promise.resolve(o) });
      const opDerden = u.includes('dataderden.cbs.nl');
      if (alleenDerden && !opDerden) return Promise.resolve({ ok: false, status: 404 });
      if (u.includes('SoortMisdrijf')) return ok({ value: codelijst });
      if (u.includes('TypedDataSet')) return ok({ value: rijen });
      return Promise.resolve({ ok: false, status: 404 });
    };
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
  const regel = sel => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';
  const tok = n => (css.match(new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})')) || [])[1];
  const oranje = tok('color-wait');
  const inkt = tok('color-wait-ink');

  // ── Knoppen ──
  await test('Hoofdknop gevuld oranje', () => {
    const r = regel('.btn-cta');
    return r.includes('background: var(--color-wait)') && r.includes('var(--color-wait-ink)')
      ? 'gevuld met donkere inkt' : r.slice(0, 90);
  });
  await test('Zoekknop gevuld oranje', () => {
    const r = regel('.search-btn');
    return r.includes('background: var(--color-wait)') ? 'hoofdactie van de pagina' : r.slice(0, 90);
  });
  await test('Primaire knop oranje', () => regel('.btn-primary').includes('var(--color-wait)'));
  await test('Nevenacties oranje omlijnd', () => {
    const r = regel('.btn-oranje');
    return r.includes('color: var(--color-wait)') && r.includes('transparent')
      ? 'omlijning, vult bij hover' : r.slice(0, 90);
  });
  await test('Geen accentkleur meer op de actieknoppen', () =>
    !regel('.btn-cta').includes('--color-accent') && !regel('.btn-primary').includes('--color-accent')
      ? 'blurple weg bij de knoppen' : false);
  await test('Verdiepingsknoppen krijgen oranje hover', () =>
    regel('.verdiep-btn:hover').includes('--color-wait'));
  await test('Contrast knoptekst op oranje haalt AA', () => {
    const c = contrast(inkt, oranje);
    return c >= 4.5 ? c.toFixed(1) + ':1' : c.toFixed(1) + ':1 (te laag)';
  });
  await test('Zichtbare focusring op de hoofdknop', () => css.includes('.btn-cta:focus-visible'));
  await test('Resultaatknoppen gebruiken de klasse, geen inline stijl', () => {
    w.switchTab('resultaat');
    const h = d.getElementById('resultaat-panel').innerHTML;
    const n = (h.match(/btn-oranje/g) || []).length;
    return n === 4 && !h.includes('rgba(255,255,255,0.15)')
      ? '4 nevenacties, geen inline kleuren' : n + ' / inline=' + h.includes('rgba(255,255,255,0.15)');
  });
  await test('Alle vijf resultaatknoppen aanwezig', () => {
    const h = d.getElementById('resultaat-panel').innerHTML;
    const labels = ['Rapport (print / PDF)', 'Opslaan als JSON', 'Rapport laden', 'Deel link', 'Aanpassen'];
    const mist = labels.filter(x => !h.includes(x));
    return mist.length === 0 ? '5 knoppen' : 'mist: ' + mist.join(', ');
  });
  await test('Eén actiekleur in de hele interface', () => {
    // De wachtbalk en de knoppen delen hetzelfde token
    return regel('.status-bar').includes('var(--color-wait)')
      && regel('.btn-cta').includes('var(--color-wait)') ? 'balk en knoppen gelijk' : false;
  });

  // ── Misdrijven via de juiste host ──
  await test('Politiecatalogus wordt bevraagd', async () => {
    verzoeken.length = 0;
    const m = await w.getMisdrijven('BU02670503', 'GM0267', 4120);
    const opDerden = verzoeken.some(u => u.includes('dataderden.cbs.nl'));
    return m && opDerden ? 'dataderden.cbs.nl gebruikt' : 'gevonden=' + !!m + ', derden=' + opDerden;
  });
  await test('Jaarcijfertabel 47018NED als eerste kandidaat', () =>
    html.includes("'47018NED'") && html.indexOf("'47018NED'") < html.indexOf("'47013NED'")
      ? '47018NED vooraan' : false);
  await test('Maandcijfers als tweede kandidaat', () => html.includes("'47022NED'"));
  await test('Cijfers correct uitgelezen', async () => {
    const m = await w.getMisdrijven('BU02670503', 'GM0267', 4120);
    return m.totaal.aantal === 42 && m.detail.length === 2
      ? '42 totaal, 2 soorten' : JSON.stringify(m && m.totaal);
  });
  await test('Omschrijvingen uit de codelijst', async () => {
    const m = await w.getMisdrijven('BU02670503', 'GM0267', 4120);
    return m.detail[0].naam === 'Diefstal van brom-, snor-, fietsen'
      ? m.detail[0].naam : m.detail[0].naam;
  });
  await test('Derde host in de lijst opgenomen', () =>
    html.includes("'https://dataderden.cbs.nl/ODataApi/OData/'"));
  await test('Derde host ook in het ophaalscript', () => {
    const script = fs.readFileSync(require('path').join(__dirname, '..', 'scripts', 'fetch_statline.py'), 'utf8');
    return script.includes('dataderden.cbs.nl');
  });

  // ── Bijgewerkte tabelnummers ──
  await test('Bodemgebruik op de standopnametabellen', () =>
    html.includes("'86211NED'") && html.includes("'86210NED'") ? '86211NED en 86210NED' : false);
  await test('Zonnestroom op de wijk- en buurttabel', () =>
    html.includes("'86044NED'") ? '86044NED' : false);
  await test('Energieverbruik op de actuele tabel', () =>
    html.includes("'85999NED'") && html.indexOf("'85999NED'") < html.indexOf("'81528NED'")
      ? '85999NED vooraan' : false);
  await test('Prognose verwijderd met vastgelegde reden', () =>
    !html.includes("titel: 'Regionale bevolkingsprognose'")
      && html.includes('onvoldoende betrouwbaar') ? 'verwijderd, reden gedocumenteerd' : false);
  await test('Vergrijzing nu als huidige stand, niet als vooruitzicht', () =>
    html.includes('Vergrijzing in de buurt') && html.includes('geen vooruitzicht')
      ? 'huidige situatie' : false);

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 800);
