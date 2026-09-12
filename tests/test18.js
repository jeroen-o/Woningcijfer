// Test: waarom energielabel en woningtype soms onbekend blijven
const INDEX = require('path').join(__dirname, '..', 'index.html');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const fouten = [];

// Laakweg 62, 3864LD Nijkerkerveen — vrijstaand in een lintbebouwing
const LAT = 52.20360, LON = 5.51420;

const pand = {
  type: 'Feature',
  properties: { identificatie: '0267100000012345', bouwjaar: 1974, oppervlakte: 142 },
  geometry: { type: 'Polygon', coordinates: [[
    [LON - 0.00012, LAT - 0.00010], [LON + 0.00012, LAT - 0.00010],
    [LON + 0.00012, LAT + 0.00010], [LON - 0.00012, LAT + 0.00010],
    [LON - 0.00012, LAT - 0.00010]]] },
};
const verPand = {
  type: 'Feature',
  properties: { identificatie: '0267100000099999', bouwjaar: 1980 },
  geometry: { type: 'Polygon', coordinates: [[
    [LON + 0.0010, LAT], [LON + 0.0012, LAT], [LON + 0.0012, LAT + 0.0002],
    [LON + 0.0010, LAT + 0.0002], [LON + 0.0010, LAT]]] },
};

// Verblijfsobjecten: met en zonder pandidentificatie, om beide routes te toetsen
const vboMetId = [
  { properties: { pandidentificatie: '0267100000012345', oppervlakte: 140, gebruiksdoel: ['woonfunctie'] },
    geometry: { type: 'Point', coordinates: [LON, LAT] } },
];
const vboZonderId = [
  { properties: { oppervlakte: 140, gebruiksdoel: ['woonfunctie'] },
    geometry: { type: 'Point', coordinates: [LON, LAT] } },
  { properties: { oppervlakte: 95, gebruiksdoel: ['woonfunctie'] },
    geometry: { type: 'Point', coordinates: [LON + 0.0011, LAT + 0.0001] } },
];
const vboAppartement = Array.from({ length: 6 }, (_, i) => ({
  properties: { pandidentificatie: '0267100000012345', oppervlakte: 70, gebruiksdoel: ['woonfunctie'] },
  geometry: { type: 'Point', coordinates: [LON, LAT] },
}));

let pandScenario = 'vrijstaand';
let vboScenario = 'met-id';
let epoScenario = 'geen-sleutel';

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://example.org/', pretendToBeVisual: true,
  beforeParse(win) {
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {}; win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
    win.fetch = (url, opts) => {
      const u = decodeURIComponent(String(url));
      const ok = o => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(o) });

      if (u.includes('bag:pand')) {
        if (pandScenario === 'leeg') return ok({ features: [] });
        if (pandScenario === 'rij') {
          // Drie aangrenzende panden: tussenwoning
          const buur = (dx) => ({ type: 'Feature', properties: { identificatie: 'x' + dx },
            geometry: { type: 'Polygon', coordinates: [[
              [LON + dx - 0.00010, LAT - 0.00008], [LON + dx + 0.00010, LAT - 0.00008],
              [LON + dx + 0.00010, LAT + 0.00008], [LON + dx - 0.00010, LAT + 0.00008],
              [LON + dx - 0.00010, LAT - 0.00008]]] } });
          return ok({ features: [pand, buur(0.00013), buur(-0.00013)] });
        }
        return ok({ features: [pand, verPand] });
      }
      if (u.includes('bag:verblijfsobject')) {
        if (vboScenario === 'faalt') return Promise.resolve({ ok: false, status: 500 });
        if (vboScenario === 'zonder-id') return ok({ features: vboZonderId });
        if (vboScenario === 'appartement') return ok({ features: vboAppartement });
        return ok({ features: vboMetId });
      }
      if (u.includes('ep-online.nl')) {
        const hdr = (opts && opts.headers) || {};
        if (epoScenario === 'geen-sleutel' || !hdr.Authorization) {
          return Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) });
        }
        if (epoScenario === 'niet-gevonden') {
          return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
        }
        if (epoScenario === 'onbereikbaar') return Promise.reject(new Error('netwerk'));
        return ok([{ labelLetter: 'C' }]);
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

  // ── Energielabel: waarom faalt het ──
  await test('Zonder sleutel wordt de API niet eens gevraagd', async () => {
    const r = await w.fetchEnergyLabel('3864LD', '62');
    return r === null && w.epoStatus().laatsteFout === 'geen-sleutel'
      ? 'reden: geen-sleutel' : r + '/' + w.epoStatus().laatsteFout;
  });
  await test('Reden wordt onderscheiden van "geen label"', () => {
    const rd = w.labelFaalReden('3864LD', '62');
    return rd.kort === 'geen API-sleutel ingesteld'
      && rd.lang.includes('niet vastgesteld') ? rd.kort : false;
  });
  await test('Ontbrekende bulkexport wordt niet als verklaring gebruikt', () => {
    const st = w.epoStatus();
    const rd = w.labelFaalReden('3864LD', '62');
    return st.bulkActief && !st.bulkAanwezig && rd.kort !== 'niet in de bulkexport'
      ? 'ingesteld maar niet aanwezig: valt terug op de API-reden' : rd.kort;
  });
  await test('Deeplink naar ep-online.nl voor dit adres', () => {
    const u = w.epoDeeplink('3864 LD', '62');
    return u.includes('ep-online.nl') && u.includes('3864LD') && u.includes('62') ? u.slice(0, 78) : u;
  });

  await test('Met sleutel wordt het label wel opgehaald', async () => {
    w.epoSleutelInstellen('test-sleutel');
    epoScenario = 'ok';
    const r = await w.fetchEnergyLabel('3864LD', '62');
    return r === 'C' ? 'label C' : String(r);
  });
  await test('404 betekent: geen label geregistreerd', async () => {
    epoScenario = 'niet-gevonden';
    const r = await w.fetchEnergyLabel('3864LD', '62');
    const rd = w.labelFaalReden('3864LD', '62');
    return r === null && w.epoStatus().laatsteFout === 'niet-gevonden'
      && rd.kort.includes('geen geregistreerd label') ? rd.kort : w.epoStatus().laatsteFout;
  });
  await test('Netwerkfout betekent: niet vastgesteld', async () => {
    epoScenario = 'onbereikbaar';
    const r = await w.fetchEnergyLabel('3864LD', '62');
    const rd = w.labelFaalReden('3864LD', '62');
    return r === null && rd.kort === 'EP-Online onbereikbaar' ? rd.kort : w.epoStatus().laatsteFout;
  });
  await test('Nieuwere API-versie aangeroepen', () => html.includes('/api/v5/PandEnergielabel/Adres'));
  await test('Sleutel via URL instelbaar voor een test', () => html.includes("get('epokey')"));
  await test('Waarschuwing dat een sleutel in de pagina leesbaar is', () =>
    html.includes('voor iedere bezoeker leesbaar'));
  w.epoSleutelInstellen('');
  epoScenario = 'geen-sleutel';

  // ── Woningtype ──
  await test('Vrijstaand herkend zonder aangrenzende panden', async () => {
    pandScenario = 'vrijstaand'; vboScenario = 'met-id';
    const r = await w.getWoningtypeBAG(LAT, LON, null);
    return r && r.type === 'vrijstaand' && r.buren === 0
      ? 'vrijstaand, 0 buren' : 'type=' + (r && r.type) + ', buren=' + (r && r.buren);
  });
  await test('Verblijfsobjecten geteld via pandidentificatie', async () => {
    const r = await w.getWoningtypeBAG(LAT, LON, null);
    return r.aantalVbo === 1 && r.vboBron === 'pandidentificatie' ? '1 via pand-id' : JSON.stringify(r);
  });
  await test('Tussenwoning herkend bij twee aangrenzende panden', async () => {
    pandScenario = 'rij';
    const r = await w.getWoningtypeBAG(LAT, LON, null);
    pandScenario = 'vrijstaand';
    return r && r.type === 'rijtjeswoning' && r.buren === 2
      ? 'rijtjeswoning, 2 buren' : 'type=' + (r && r.type) + ', buren=' + (r && r.buren);
  });
  await test('Appartement herkend bij meerdere woningen in één pand', async () => {
    vboScenario = 'appartement';
    const r = await w.getWoningtypeBAG(LAT, LON, null);
    vboScenario = 'met-id';
    return r && r.type === 'appartement' && r.aantalVbo === 6 ? '6 woningen in het pand' : false;
  });

  await test('Zonder pandidentificatie wordt geometrisch geteld', async () => {
    vboScenario = 'zonder-id';
    const r = await w.getWoningtypeBAG(LAT, LON, null);
    vboScenario = 'met-id';
    return r && r.aantalVbo === 1 && r.vboBron.includes('geometrisch')
      ? '1 binnen de pandcontour' : false;
  });
  await test('Falende objectlaag blokkeert het type niet', async () => {
    vboScenario = 'faalt';
    const r = await w.getWoningtypeBAG(LAT, LON, null);
    vboScenario = 'met-id';
    return r && r.type === 'vrijstaand' && r.aantalVbo === null
      ? 'type bepaald op aangrenzende panden' : 'type=' + (r && r.type);
  });
  await test('Geen panden geeft null', async () => {
    pandScenario = 'leeg';
    const r = await w.getWoningtypeBAG(LAT, LON, null);
    pandScenario = 'vrijstaand';
    return r === null ? 'null (correct)' : JSON.stringify(r);
  });
  await test('Eigen pand telt niet als buur', async () => {
    pandScenario = 'vrijstaand';
    const r = await w.getWoningtypeBAG(LAT, LON, null);
    // Twee panden in de bbox, waarvan het tweede op circa 68 meter
    return r.panden === 2 && r.buren === 0 ? '2 panden, 0 aangrenzend' : r.panden + '/' + r.buren;
  });
  await test('Diagnosegegevens meegeleverd', async () => {
    const r = await w.getWoningtypeBAG(LAT, LON, null);
    return r.panden && r.afstandPand !== undefined
      ? r.panden + ' panden, pand op ' + r.afstandPand + ' m' : false;
  });
  await test('Toelichting meldt dat de BAG geen woningtype kent', () =>
    html.includes('de BAG kent geen veld voor woningtype'));
  await test('Bij mislukken wordt de gebruiker om invoer gevraagd', () =>
    html.includes('Kies het type zelf in het tabblad Woning'));

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 800);
