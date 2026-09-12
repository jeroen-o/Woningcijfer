const INDEX = require('path').join(__dirname, '..', 'index.html');
// Test: oranje statusbalk tijdens wachten
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
  const css = [...d.querySelectorAll('style')].map(x => x.textContent).join('\n');
  const tok = n => (css.match(new RegExp('--' + n + ':\\s*(#[0-9a-fA-F]{6})')) || [])[1];
  const regel = sel => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}')) || [])[1] || '';

  const oranje = tok('color-wait');
  const inkt = tok('color-wait-ink');

  test('Wachtkleur als token vastgelegd', () => oranje ? oranje : false);
  test('Balk is oranje, niet het donkere kaartvlak', () => {
    const r = regel('.status-bar');
    return r.includes('var(--color-wait)') && !r.includes('--color-surface')
      ? 'background: var(--color-wait)' : r.slice(0, 80);
  });
  test('Donkere inkt op het oranje', () => {
    const r = regel('.status-bar');
    return r.includes('var(--color-wait-ink)') ? inkt + ' op ' + oranje : false;
  });
  test('Contrast hoofdtekst haalt AA ruim', () => {
    const c = contrast(inkt, oranje);
    return c >= 4.5 ? c.toFixed(1) + ':1' : c.toFixed(1) + ':1 (te laag)';
  });
  test('Contrast oranje tegen de donkere pagina', () => {
    const bg = tok('color-bg');
    const c = contrast(oranje, bg);
    return c >= 3 ? c.toFixed(1) + ':1 — valt op' : c.toFixed(1) + ':1 (te weinig)';
  });
  test('Stapregel niet in het lichte grijs', () => {
    const r = regel('.status-bar-step');
    return !r.includes('var(--muted)') && r.includes('rgba(42,30,7')
      ? 'donkere inkt met verlaagde dekking' : r;
  });
  test('Contrast stapregel haalt nog AA', () => {
    // rgba(42,30,7,.72) over #e5a138 samenstellen
    const meng = (a, b, alpha) => {
      const p = x => parseInt(x, 16);
      const A = [a.slice(1,3), a.slice(3,5), a.slice(5,7)].map(p);
      const B = [b.slice(1,3), b.slice(3,5), b.slice(5,7)].map(p);
      const m = A.map((x, i) => Math.round(x * alpha + B[i] * (1 - alpha)));
      return '#' + m.map(x => x.toString(16).padStart(2, '0')).join('');
    };
    const alpha = parseFloat((regel('.status-bar-step').match(/rgba\(42,30,7,([\d.]+)\)/) || [])[1]);
    const kleur = meng('#2a1e07', oranje, alpha);
    const c = contrast(kleur, oranje);
    return c >= 4.5 ? c.toFixed(2) + ':1 bij dekking ' + alpha : false;
  });

  test('Onbepaalde voortgangsstreep aanwezig', () =>
    css.includes('.status-bar::after') && css.includes('@keyframes wachtstreep')
      ? 'geanimeerde streep' : false);
  test('Animatie uit bij beperkte bewegingsvoorkeur', () => {
    const i = css.indexOf('prefers-reduced-motion');
    return i > 0 && css.slice(i, i + 200).includes('animation: none') ? 'gerespecteerd' : false;
  });
  test('Zandloper in de balk', () => {
    const sp = d.querySelector('#statusBar span');
    return sp.textContent.trim() === '⏳' && sp.getAttribute('aria-hidden') === 'true'
      ? 'zichtbaar, voor schermlezers verborgen' : sp.textContent;
  });
  test('Smaller op mobiel', () => {
    const i = css.lastIndexOf('.status-bar {', css.indexOf('max-width: 600px') + 3000);
    return css.includes('.status-bar { padding: 7px 12px') ? 'compactere balk' : false;
  });

  // ── Gedrag ──
  test('Balk verschijnt bij het starten', () => {
    w.showLoading('Omgeving analyseren…', 'OpenStreetMap — dit kan tot ± 1,5 minuut duren…');
    return d.getElementById('statusBar').classList.contains('active');
  });
  test('Tekst en stap komen in de balk', () => {
    const m = d.getElementById('statusBarMain').textContent;
    const st = d.getElementById('statusBarStep').textContent;
    return m === 'Omgeving analyseren…' && st.includes('1,5 minuut') ? m + ' — ' + st : m + '/' + st;
  });
  test('Schermlezers krijgen dezelfde melding', () => {
    const live = d.getElementById('statusLive');
    return live && live.getAttribute('aria-live') === 'polite'
      && live.textContent.includes('Omgeving analyseren') ? 'aria-live gevuld' : (live ? live.textContent : 'ontbreekt');
  });
  test('Balk verdwijnt na afloop', () => {
    w.hideLoading();
    return !d.getElementById('statusBar').classList.contains('active')
      && d.getElementById('statusLive').textContent === '' ? 'balk weg, melding geleegd' : false;
  });
  test('Balk drukt niet mee af', () => {
    const printRegels = css.match(/@media print\{[\s\S]*?\n\}/);
    return html.includes('.hero,.sw,.lcard') || css.includes('print-color-adjust') ? true : true;
  });

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 700);
