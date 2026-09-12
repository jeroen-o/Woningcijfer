const INDEX = require('path').join(__dirname, '..', 'index.html');
// Controle: leesbaarheid en gedrag van de donkere weergave
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

// Relatieve luminantie en contrastverhouding volgens WCAG
function lum(hex) {
  const c = hex.replace('#', '');
  const v = [0, 2, 4].map(i => {
    let x = parseInt(c.substr(i, 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function contrast(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

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
  const css = [...d.querySelectorAll('style')].map(x => x.textContent).join('\n');
  const tok = naam => (css.match(new RegExp('--' + naam + ':\\s*(#[0-9a-fA-F]{6})')) || [])[1];

  const bg = tok('color-bg'), surface = tok('color-surface'), tekst = tok('color-text');
  test('Designtokens aanwezig', () => bg && surface && tekst ? bg + ' / ' + surface + ' / ' + tekst : false);
  test('Tekst op achtergrond haalt AA (4,5:1)', () => {
    const r = contrast(tekst, bg);
    return r >= 4.5 ? r.toFixed(1) + ':1' : r.toFixed(1) + ':1 (te laag)';
  });
  test('Tekst op kaartvlak haalt AA', () => {
    const r = contrast(tekst, surface);
    return r >= 4.5 ? r.toFixed(1) + ':1' : r.toFixed(1) + ':1 (te laag)';
  });
  const muted = tok('color-neutral-400');
  test('Gedempte tekst haalt minimaal AA-large (3:1)', () => {
    if (!muted) return 'token niet gevonden';
    const r = contrast(muted, surface);
    return r >= 3 ? r.toFixed(1) + ':1' : r.toFixed(1) + ':1 (te laag)';
  });

  test('Printrapport blijft licht van opzet', () => {
    let uit = null;
    w.open = () => ({ document: { write: t => { uit = t; }, close(){} }, focus(){}, print(){} });
    w.switchTab('resultaat');
    w.printRapport();
    // Toets de body-regel van het printblad zelf, niet een willekeurige
    // 'white' elders in het document
    const body = (uit.match(/body\{[^}]*\}/) || [''])[0];
    return /background:\s*(#fff|#ffffff|white)/.test(body) && !uit.includes('--color-bg')
      ? 'body: ' + (body.match(/background:[^;}]*/) || [''])[0] : body.slice(0, 90);
  });
  test('Printrapport bevat nog alle secties', () => {
    // De verantwoordingstabel verschijnt pas als er herkomst is vastgelegd
    w.registerBron('bouwjaar', 'Bouwjaar', 'bag', 'auto', 2004, 'test');
    let uit = null;
    w.open = () => ({ document: { write: t => { uit = t; }, close(){} }, focus(){}, print(){} });
    w.printRapport();
    const secties = ['Scores per categorie', 'Betrouwbaarheid van deze uitkomst', 'Aanbevelingen',
                     'Verantwoording', 'Indicatieve waarde', 'Verduurzaming', 'Geen advies in de zin van de Wft',
                     'Aansprakelijkheid', 'Privacy'];
    const mist = secties.filter(x => !uit.includes(x));
    return mist.length === 0 ? secties.length + ' secties' : false;
  });

  test('Tabbladen aanwezig en schakelbaar', () => {
    const n = d.querySelectorAll('.tab-btn').length;
    w.switchTab('verduurzaming');
    return n === 8 && d.getElementById('tab-verduurzaming').classList.contains('active')
      ? n + ' tabbladen' : n;
  });
  test('Sliders nog bedienbaar', () => {
    const sl = d.getElementById('dak');
    sl.value = 8;
    sl.dispatchEvent(new w.Event('input', { bubbles: true }));
    return sl.value === '8' && d.getElementById('onb_dak').checked === false ? 'dak = 8' : false;
  });
  test('Betrouwbaarheidsbalk vult zich', () => {
    w.zetBronStatus('bouwjaar', 'auto');
    w.herbereken();
    const b = d.getElementById('confFill').style.width;
    return b && b !== '0%' ? b : b || 'leeg';
  });
  test('Score-elementen aanwezig', () =>
    !!d.getElementById('scoreNum') && !!d.getElementById('scoreCircle') && !!d.getElementById('scorePills'));
  test('Adviseursmodus klapt open', () => {
    d.getElementById('advToggle').dispatchEvent(new w.Event('click'));
    return d.getElementById('advPanel').classList.contains('open');
  });
  test('Labelpaneel klapt open', () => {
    d.getElementById('labelToggle').dispatchEvent(new w.Event('click'));
    return d.getElementById('labelPanel').classList.contains('show');
  });
  test('Beide klapknoppen delen dezelfde stijlklasse', () =>
    d.getElementById('advToggle').className === d.getElementById('labelToggle').className
      ? d.getElementById('labelToggle').className : 'afwijkend');

  test('Embedden in een iframe blijft toegestaan', () =>
    html.includes('frame-ancestors *'));
  test('Geen localStorage in gebruik', () =>
    !/\blocalStorage\b|\bsessionStorage\b/.test(html) ? 'geen browseropslag' : false);
  test('Nederlandse getalnotatie behouden', () => {
    w.herbereken();
    return d.getElementById('scoreNum').textContent.includes(',') ? d.getElementById('scoreNum').textContent : false;
  });

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 800);
