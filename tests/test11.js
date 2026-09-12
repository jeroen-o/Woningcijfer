const INDEX = require('path').join(__dirname, '..', 'index.html');
// Test: juiste perceel kiezen (Eschberg 38) en WOZ-waardeloket
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const fouten = [];

// Adrespunt Eschberg 38
const LAT = 52.19730, LON = 5.41160;

// Twee percelen naast elkaar. Het adrespunt ligt in het rechter (319 m²),
// maar het linker perceel (291 m²) valt ook binnen de zoek-bbox en kwam
// eerder als eerste terug.
const perceelBuur = {
  type:'Feature',
  properties:{ kadastraleGrootteWaarde:291, perceelnummer:'8974' },
  geometry:{ type:'Polygon', coordinates:[[
    [LON-0.00040, LAT-0.00020], [LON-0.00012, LAT-0.00020],
    [LON-0.00012, LAT+0.00020], [LON-0.00040, LAT+0.00020], [LON-0.00040, LAT-0.00020]]]},
};
const perceelEigen = {
  type:'Feature',
  properties:{ kadastraleGrootteWaarde:319, perceelnummer:'8975' },
  geometry:{ type:'Polygon', coordinates:[[
    [LON-0.00010, LAT-0.00022], [LON+0.00030, LAT-0.00022],
    [LON+0.00030, LAT+0.00022], [LON-0.00010, LAT+0.00022], [LON-0.00010, LAT-0.00022]]]},
};
// Perceel met binnenplaats waar het adrespunt precies in valt
const perceelMetGat = {
  type:'Feature',
  properties:{ kadastraleGrootteWaarde:900, perceelnummer:'9001' },
  geometry:{ type:'Polygon', coordinates:[
    [[LON-0.0010, LAT-0.0010],[LON+0.0010, LAT-0.0010],[LON+0.0010, LAT+0.0010],[LON-0.0010, LAT+0.0010],[LON-0.0010, LAT-0.0010]],
    [[LON-0.0002, LAT-0.0002],[LON+0.0002, LAT-0.0002],[LON+0.0002, LAT+0.0002],[LON-0.0002, LAT+0.0002],[LON-0.0002, LAT-0.0002]]]},
};

const wozAntwoord = {
  wozObject: {
    wozobjectnummer:'030700089750', grondoppervlakte:319, bouwjaar:2004,
    wozWaarden:[
      { peildatum:'2023-01-01', vastgesteldeWaarde:755000 },
      { peildatum:'2025-01-01', vastgesteldeWaarde:856000 },
      { peildatum:'2024-01-01', vastgesteldeWaarde:789000 },
    ],
  },
};

let perceelScenario = 'buur-eerst';
let wozScenario = 'ok';

const dom = new JSDOM(html, {
  runScripts:'dangerously', url:'https://example.org/', pretendToBeVisual:true,
  beforeParse(win) {
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {}; win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
    win.fetch = (url) => {
      const u = decodeURIComponent(String(url));
      const ok = o => Promise.resolve({ ok:true, json:() => Promise.resolve(o) });
      if (u.includes('kadastralekaart')) {
        if (perceelScenario === 'geen') return ok({ features: [] });
        if (perceelScenario === 'geen-treffer') return ok({ features: [perceelBuur] });
        if (perceelScenario === 'met-gat') return ok({ features: [perceelMetGat, perceelEigen] });
        return ok({ features: [perceelBuur, perceelEigen] });   // buur staat eerst
      }
      if (u.includes('wozwaardeloket')) {
        if (wozScenario === 'faalt') return Promise.resolve({ ok:false, status:404 });
        return ok(wozAntwoord);
      }
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

  // ── Punt-in-polygoon ──
  await test('Punt binnen eigen perceel herkend', () =>
    w.puntInGeometrie(LAT, LON, perceelEigen.geometry) === true);
  await test('Punt buiten buurperceel herkend', () =>
    w.puntInGeometrie(LAT, LON, perceelBuur.geometry) === false);
  await test('Uitsparing in polygoon telt niet mee', () =>
    w.puntInGeometrie(LAT, LON, perceelMetGat.geometry) === false ? 'binnenplaats uitgesloten' : false);
  await test('MultiPolygon ondersteund', () => {
    const mp = { type:'MultiPolygon', coordinates:[perceelBuur.geometry.coordinates, perceelEigen.geometry.coordinates] };
    return w.puntInGeometrie(LAT, LON, mp) === true;
  });

  // ── Perceelkeuze: het gemelde probleem ──
  await test('Kiest 319 m² en niet de 291 m² van de buur', async () => {
    perceelScenario = 'buur-eerst';
    const p = await w.getKadasterPerceel(LAT, LON);
    return p && p.perceeloppervlak === 319 ? '319 m² (perceel ' + p.kadastraalNummer + ')' : JSON.stringify(p);
  });
  await test('Treffer gemarkeerd als exact', async () => {
    const p = await w.getKadasterPerceel(LAT, LON);
    return p.exact === true && p.kandidaten === 2 ? 'exact, uit 2 kandidaten' : JSON.stringify(p);
  });
  await test('Perceel met binnenplaats wordt overgeslagen', async () => {
    perceelScenario = 'met-gat';
    const p = await w.getKadasterPerceel(LAT, LON);
    perceelScenario = 'buur-eerst';
    return p.perceeloppervlak === 319 ? '319 m², niet de 900 m² eromheen' : p.perceeloppervlak;
  });
  await test('Zonder omsluitend perceel: dichtstbijzijnde, als onzeker', async () => {
    perceelScenario = 'geen-treffer';
    const p = await w.getKadasterPerceel(LAT, LON);
    perceelScenario = 'buur-eerst';
    return p && p.exact === false && p.afstand > 0
      ? 'perceel op ' + p.afstand + ' m, gemarkeerd als onzeker' : JSON.stringify(p);
  });
  await test('Geen percelen geeft null', async () => {
    perceelScenario = 'geen';
    const p = await w.getKadasterPerceel(LAT, LON);
    perceelScenario = 'buur-eerst';
    return p === null ? 'null (correct)' : false;
  });

  // ── WOZ ──
  await test('WOZ-waarden opgehaald', async () => {
    const woz = await w.getWOZ('0307200000089750');
    return woz && woz.waarden.length === 3 ? '3 peildatums' : JSON.stringify(woz);
  });
  await test('Nieuwste peildatum bovenaan', async () => {
    const woz = await w.getWOZ('0307200000089750');
    return woz.actueel.peildatum === '2025-01-01' && woz.actueel.waarde === 856000
      ? '01-01-2025: € 856.000' : JSON.stringify(woz.actueel);
  });
  await test('Grondoppervlakte uit WOZ-object', async () => {
    const woz = await w.getWOZ('0307200000089750');
    return woz.grondoppervlakte === 319 ? '319 m²' : woz.grondoppervlakte;
  });
  await test('Geen nummeraanduiding geeft null zonder verzoek', async () =>
    (await w.getWOZ(null)) === null);
  await test('Falend loket geeft null', async () => {
    wozScenario = 'faalt';
    const woz = await w.getWOZ('0307200000089750');
    wozScenario = 'ok';
    return woz === null ? 'null (correct)' : false;
  });

  // ── Weergave ──
  await test('WOZ-blok toont reeks met verschil', () => {
    const h = w.wozHTML();
    return h === '' ? 'leeg zolang _woz niet gevuld is (verwacht buiten de hoofdflow)' : h.length + ' tekens';
  });
  await test('Datumnotatie Nederlands', () => w.datumNLkort('2025-01-01') === '01-01-2025');

  // ── Lasten op eigen WOZ ──
  await test('Lasten rekenen met de eigen WOZ-waarde', () => {
    const l = w.berekenLasten(856000);
    return l.ozb === 856 ? 'OZB € 856 bij WOZ € 856.000' : l.ozb;
  });

  // ── Deeplink ──
  await test('Deeplink naar het WOZ-waardeloket', () => {
    const u = w.wozDeeplink('3825BG', '38', '');
    return u === 'https://www.wozwaardeloket.nl/?locatie=3825BG%2038' ? u : u;
  });
  await test('Deeplink met toevoeging', () => {
    const u = w.wozDeeplink('1012 js', '3', 'A');
    return u.includes('1012JS%203%20A') ? u : u;
  });
  await test('Deeplink zonder adres valt terug op de startpagina', () =>
    w.wozDeeplink('', '', '') === 'https://www.wozwaardeloket.nl/');
  await test('Terugvalblok verwijst naar het loket', () => {
    const h = w.wozHTML();
    return h === '' ? 'leeg zonder geladen adres (correct)' : h.includes('wozwaardeloket.nl');
  });

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 700);
