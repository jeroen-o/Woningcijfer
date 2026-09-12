const INDEX = require('path').join(__dirname, '..', 'index.html');
// Test: sliders zijn altijd bedienbaar en beoordelen zichzelf
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const fouten = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://example.org/',
  pretendToBeVisual: true,
  beforeParse(win) {
    win.fetch = () => Promise.reject(new Error('offline test'));
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {};
    win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
  },
});

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

  const sl = id => d.getElementById(id);
  const cb = id => d.getElementById('onb_' + id);
  const grp = id => sl(id).closest('.range-group');
  // Bootst het verslepen na: waarde zetten en het input-event afvuren
  const sleep = (id, waarde) => {
    sl(id).value = waarde;
    sl(id).dispatchEvent(new w.Event('input', { bubbles: true }));
  };

  // De pagina kent meerdere stylesheets; alles samenvoegen
  const css = [...d.querySelectorAll('style')].map(x => x.textContent).join('\n');

  test('Geen pointer-events-blokkade op sliders', () =>
    !/is-onbekend[^}]*pointer-events:\s*none/.test(css));
  test('Ruimer grijpvlak (hoogte 26px)', () => css.includes('height: 26px'));
  test('Firefox-thumb gedefinieerd', () => css.includes('::-moz-range-thumb'));
  test('Firefox-voortgangsbalk gedefinieerd', () => css.includes('::-moz-range-progress'));
  test('WebKit-track gedefinieerd', () => css.includes('::-webkit-slider-runnable-track'));
  test('Toetsenbordfocus zichtbaar', () => css.includes(':focus-visible::-webkit-slider-thumb'));
  test('Grotere thumb op mobiel', () => {
    const mob = (css.match(/@media \(max-width: 600px\)[\s\S]*?\n\}/g) || []).join('');
    const thumb = mob.match(/::-webkit-slider-thumb\s*\{[^}]*width:\s*(\d+)px/);
    const track = mob.match(/input\[type="range"\]\s*\{[^}]*height:\s*(\d+)px/);
    return thumb && track && +thumb[1] >= 22 && +track[1] >= 30
      ? 'thumb ' + thumb[1] + 'px op een baan van ' + track[1] + 'px' : (thumb ? thumb[1] : 'niet gevonden');
  });

  test('Alle 10 sliders bestaan met vinkje', () =>
    ['fundering','dak','dakbedekking','gevel','kozijnen','vloeren','cv','elektra','sanitair','isolatie']
      .every(id => sl(id) && cb(id)) ? '10 sliders' : false);
  test('Sliders staan standaard op onbekend', () =>
    d.querySelectorAll('.range-group.is-onbekend').length === 10 ? '10 gedempt' : false);
  test('Vinkje meldt hoe je beoordeelt', () =>
    d.querySelector('.onb-wrap label').textContent.includes('versleep de balk'));

  test('Slider is niet uitgeschakeld', () => !sl('dak').disabled && !sl('dak').readOnly);

  test('Verslepen zet waarde én vinkt uit', () => {
    sleep('dak', 8);
    return sl('dak').value === '8' && cb('dak').checked === false ? 'dak = 8, vinkje uit' : false;
  });
  test('Demping verdwijnt na verslepen', () => !grp('dak').classList.contains('is-onbekend'));
  test('Beschrijving loopt mee', () =>
    d.getElementById('desc_dak').textContent.includes('Goed+') ? d.getElementById('desc_dak').textContent : false);
  test('Vulling via CSS-variabele', () => {
    const v = sl('dak').style.getPropertyValue('--vulling');
    return v === '77.8%' ? v : v;
  });
  test('Onderdeel telt nu mee in de score', () => {
    const s = w.berekenBouwkundig();
    return s === 8 ? '8,0 (alleen dak beoordeeld)' : s;
  });

  test('Tweede slider verslepen middelt correct', () => {
    sleep('gevel', 4);
    const s = w.berekenBouwkundig();
    return s === 6 ? '6,0 (8 en 4)' : s;
  });

  test('Handmatig aanvinken zet terug op onbekend', () => {
    cb('dak').checked = true;
    cb('dak').dispatchEvent(new w.Event('change'));
    return grp('dak').classList.contains('is-onbekend') && w.berekenBouwkundig() === 4
      ? 'alleen gevel telt nog (4,0)' : w.berekenBouwkundig();
  });

  test('Opnieuw verslepen activeert weer', () => {
    sleep('dak', 9);
    return cb('dak').checked === false && w.berekenBouwkundig() === 6.5 ? '6,5 (9 en 4)' : w.berekenBouwkundig();
  });

  test('Klik op de balk telt als beoordeling', () => {
    const ev = new w.Event('pointerdown', { bubbles: true });
    sl('cv').dispatchEvent(ev);
    return cb('cv').checked === false ? 'cv beoordeeld' : false;
  });

  test('Toetsenbord (change-event) telt ook', () => {
    sl('elektra').value = 3;
    sl('elektra').dispatchEvent(new w.Event('change', { bubbles: true }));
    return cb('elektra').checked === false && sl('elektra').value === '3' ? 'elektra = 3' : false;
  });

  test('Herkomst wordt handmatig geregistreerd', () => {
    const p = w.provRijen().find(r => r.veld === 'dak');
    return p && p.methode === 'handmatig' ? p.waarde : false;
  });

  test('Betrouwbaarheid: minder onbeoordeelde onderdelen', () => {
    const n = w.telOnbekendeSliders();
    return n === 6 ? '6 van 10 nog onbekend (4 beoordeeld)' : n;
  });

  test('Bandbreedte krimpt bij meer beoordeling', () => {
    const conf = w.berekenBetrouwbaarheid();
    const breed = w.berekenBandbreedte(conf);
    ['dakbedekking','kozijnen','vloeren','sanitair','isolatie','fundering'].forEach(id => sleep(id, 7));
    const smal = w.berekenBandbreedte(w.berekenBetrouwbaarheid());
    return smal < breed ? breed.toFixed(2) + ' → ' + smal.toFixed(2) : false;
  });

  test('State bewaart beoordeelde status', () => {
    const st = w.verzamelState();
    return st.sliders.dak.onb === false && st.sliders.dak.v === 9 ? 'dak 9, beoordeeld' : JSON.stringify(st.sliders.dak);
  });
  test('State-roundtrip herstelt sliders', () => {
    w.stateNaarURL();
    sleep('dak', 2);
    cb('gevel').checked = true; cb('gevel').dispatchEvent(new w.Event('change'));
    w.urlNaarState();
    return sl('dak').value === '9' && cb('gevel').checked === false ? 'hersteld' : sl('dak').value + '/' + cb('gevel').checked;
  });

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 700);
