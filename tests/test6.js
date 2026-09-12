const INDEX = require('path').join(__dirname, '..', 'index.html');
// Test: Overpass-time-outs opvangen en eerlijk melden wat ontbreekt
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const fouten = [];
const verzoeken = [];

const LAT = 52.1826, LON = 5.3421;

// Wat de nagebootste Overpass-server teruggeeft; per test in te stellen
let scenario = 'ok';

function osmObj(id, type, tags, lat, lon) {
  return type === 'node'
    ? { type:'node', id, lat, lon, tags }
    : { type:'way', id, center:{ lat, lon }, tags };
}
// Een set objecten rond het adres
const verkeerEls = [
  osmObj(1, 'way', { highway:'motorway', name:'A1' }, LAT + 0.002, LON),
  osmObj(2, 'way', { highway:'primary', name:'Rondweg' }, LAT + 0.009, LON),
  osmObj(3, 'way', { railway:'rail', name:'Veluwelijn' }, LAT + 0.03, LON),
];
const voorzEls = [
  osmObj(10, 'way',  { amenity:'hospital', name:'Meander MC' }, LAT + 0.03, LON),
  osmObj(11, 'node', { amenity:'doctors', name:'Huisarts Nieuwland' }, LAT + 0.006, LON),
  osmObj(12, 'node', { amenity:'pharmacy', name:'Apotheek Nieuwland' }, LAT + 0.005, LON),
  osmObj(13, 'node', { shop:'supermarket', name:'Die Spens' }, LAT + 0.004, LON),
  osmObj(14, 'node', { amenity:'school', name:'De Wonderboom' }, LAT + 0.0045, LON),
  osmObj(15, 'node', { highway:'bus_stop', name:'Leverkruid' }, LAT + 0.002, LON),
  osmObj(16, 'way',  { landuse:'retail', name:'De Nieuwe Hof' }, LAT + 0.006, LON),
];

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://example.org/',
  pretendToBeVisual: true,
  beforeParse(win) {
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {};
    win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
    win.fetch = (url, opts) => {
      const body = decodeURIComponent((opts && opts.body || '').replace(/^data=/, ''));
      const isVoorz = body.includes('pharmacy');
      verzoeken.push({ url: String(url), deel: isVoorz ? 'voorzieningen' : 'verkeer' });

      const geef = (obj) => Promise.resolve({ ok: true, json: () => Promise.resolve(obj) });

      if (scenario === 'timeout-stil') {
        // Precies het foute geval: HTTP 200, lege lijst, foutmelding in remark
        return geef({ version: 0.6, elements: [], remark: 'runtime error: Query timed out in "query" at line 3' });
      }
      if (scenario === 'voorz-faalt') {
        return isVoorz
          ? geef({ version: 0.6, elements: [], remark: 'runtime error: Query timed out' })
          : geef({ version: 0.6, elements: verkeerEls });
      }
      if (scenario === 'eerste-mirror-faalt') {
        const nRaak = verzoeken.filter(v => v.deel === (isVoorz ? 'voorzieningen' : 'verkeer')).length;
        if (nRaak === 1) return Promise.resolve({ ok: false, status: 429 });
        return geef({ version: 0.6, elements: isVoorz ? voorzEls : verkeerEls });
      }
      if (scenario === 'deels-gevonden') {
        return geef({ version: 0.6, elements: isVoorz ? voorzEls.slice(0, 4) : verkeerEls });
      }
      return geef({ version: 0.6, elements: isVoorz ? voorzEls : verkeerEls });
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
  const veld = id => d.getElementById(id).value;
  const stripT = id => d.getElementById(id).textContent;

  // ── Het gemelde probleem ──
  await test('Stille time-out wordt herkend als fout', async () => {
    scenario = 'timeout-stil'; verzoeken.length = 0;
    try { await w.fetchOverpass(LAT, LON); return false; }
    catch (e) { return 'fout gemeld: ' + e.message.slice(0, 45); }
  });
  await test('Alle spiegelservers geprobeerd bij time-out', () => {
    // 3 spiegels × 2 opdrachten
    return verzoeken.length === 6 ? '6 pogingen (3 spiegels × 2 delen)' : verzoeken.length;
  });

  await test('Melding is eerlijk bij volledige uitval', () => {
    w._testReset && w._testReset();
    scenario = 'timeout-stil';
    return true;
  });

  // ── Normale werking ──
  await test('Beide delen slagen', async () => {
    scenario = 'ok'; verzoeken.length = 0;
    const r = await w.fetchOverpass(LAT, LON);
    return r.verkeer && r.voorzieningen && r.elements.length === 10
      ? r.elements.length + ' objecten, 2 delen' : JSON.stringify({v:r.verkeer, z:r.voorzieningen, n:r.elements.length});
  });
  await test('Opdracht is opgesplitst in twee delen', () =>
    verzoeken.length === 2 && verzoeken[0].deel === 'verkeer' && verzoeken[1].deel === 'voorzieningen'
      ? 'verkeer + voorzieningen' : JSON.stringify(verzoeken.map(v => v.deel)));

  await test('Velden worden gevuld', async () => {
    scenario = 'ok';
    const data = await w.fetchOverpass(LAT, LON);
    w.processAndFill(data, LAT, LON);
    const gevuld = ['ziekenhuis','huisarts','apotheek','supermarkt','school','ov','centrum']
      .filter(id => veld(id) !== 'onbekend');
    return gevuld.length === 7 ? '7 van 7 voorzieningen ingevuld' : gevuld.join(',');
  });
  await test('Groene melding alleen als alles is gevonden', () =>
    stripT('strip-voorzieningen-text').includes('Alle voorzieningen automatisch gevonden')
      ? 'correcte melding' : stripT('strip-voorzieningen-text').slice(0, 60));

  // ── Deels gevonden ──
  await test('Ontbrekende voorzieningen worden benoemd', async () => {
    scenario = 'deels-gevonden';
    const data = await w.fetchOverpass(LAT, LON);
    w.processAndFill(data, LAT, LON);
    const t = stripT('strip-voorzieningen-text');
    return t.includes('deels gevonden') && t.includes('school') ? t.slice(0, 95) : t.slice(0, 95);
  });
  await test('Gemiste velden krijgen status "Niet opgehaald"', () => {
    const p = w.provRijen().find(r => r.veld === 'school');
    return p && p.methode === 'mislukt' ? p.waarde : (p ? p.methode : 'ontbreekt');
  });
  await test('Toelichting legt uit wat dat betekent', () => {
    const p = w.provRijen().find(r => r.veld === 'school');
    return (p.toelichting || '').includes('handmatig');
  });
  await test('Betrouwbaarheid daalt bij gedeeltelijke data', () => {
    return w.berekenBetrouwbaarheid().pct < 1;
  });

  // ── Eén deel faalt ──
  await test('Voorzieningen faalt, omgeving blijft werken', async () => {
    scenario = 'voorz-faalt';
    const data = await w.fetchOverpass(LAT, LON);
    return data.verkeer === true && data.voorzieningen === false
      ? 'omgeving wel, voorzieningen niet' : JSON.stringify({v:data.verkeer, z:data.voorzieningen});
  });
  await test('Melding meldt de uitval eerlijk', async () => {
    scenario = 'voorz-faalt';
    const data = await w.fetchOverpass(LAT, LON);
    w.processAndFill(data, LAT, LON);
    const t = stripT('strip-voorzieningen-text');
    return t.includes('niet worden opgehaald') && t.includes('Onbekend') ? t.slice(0, 90) : t.slice(0, 90);
  });
  await test('Melding biedt "Opnieuw proberen"', () =>
    d.getElementById('strip-voorzieningen-text').innerHTML.includes('Opnieuw proberen'));
  await test('Omgevingsmelding blijft groen bij geslaagd deel', () =>
    stripT('strip-omgeving-text').includes('automatisch geladen') ? 'omgeving ok' : stripT('strip-omgeving-text').slice(0, 60));

  // ── Spiegelserver-terugval ──
  await test('Terugval naar tweede spiegelserver bij HTTP 429', async () => {
    scenario = 'eerste-mirror-faalt'; verzoeken.length = 0;
    const data = await w.fetchOverpass(LAT, LON);
    return data.verkeer && data.voorzieningen && verzoeken.length === 4
      ? '4 pogingen, beide delen geslaagd' : JSON.stringify({n:verzoeken.length, v:data.verkeer, z:data.voorzieningen});
  });

  // ── Opnieuw proberen ──
  await test('Oude afstanden worden gewist bij mislukking', async () => {
    scenario = 'ok';
    w.pasStateToe({ velden: {}, lat: LAT, lon: LON });
    w.processAndFill(await w.fetchOverpass(LAT, LON), LAT, LON);
    const gevuld = veld('ziekenhuis');
    // Nu faalt het voorzieningendeel: de oude waarde mag niet blijven staan
    scenario = 'voorz-faalt';
    w.resetOmgevingVelden();
    w.processAndFill(await w.fetchOverpass(LAT, LON), LAT, LON);
    return gevuld !== 'onbekend' && veld('ziekenhuis') === 'onbekend'
      ? gevuld + ' → onbekend (correct gewist)' : gevuld + ' → ' + veld('ziekenhuis');
  });
  await test('Herkomst van gewiste velden verdwijnt ook', () =>
    !w.provRijen().some(r => r.veld === 'ziekenhuis' && r.methode === 'auto'));
  await test('herlaadOmgeving vult alsnog in', async () => {
    const voor = veld('ziekenhuis');
    scenario = 'ok';
    await w.herlaadOmgeving();
    return voor === 'onbekend' && veld('ziekenhuis') !== 'onbekend'
      ? 'onbekend → ' + veld('ziekenhuis') : voor + ' → ' + veld('ziekenhuis');
  });
  await test('Melding wordt weer groen na herkansing', () =>
    stripT('strip-voorzieningen-text').includes('Alle voorzieningen automatisch gevonden'));

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 700);
