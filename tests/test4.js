const INDEX = require('path').join(__dirname, '..', 'index.html');
// Test: kaart ophalen/insluiten en resultaat direct tonen
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const fouten = [];
const verzoeken = [];

// Nagebootste PNG (geldige header, ruim boven de minimumgrootte)
const nepPng = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(4000, 7),
]);

// Bepaalt welke kandidaat "slaagt": index in de kandidatenlijst
let slaagtVanaf = 0;

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://example.org/',
  pretendToBeVisual: true,
  beforeParse(win) {
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {};
    win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
    win.fetch = (url) => {
      verzoeken.push(String(url));
      const idx = verzoeken.length - 1;
      if (idx < slaagtVanaf) {
        // Simuleer een WMS-foutmelding: XML in plaats van een afbeelding
        return Promise.resolve({ ok: true, blob: () => Promise.resolve(
          new win.Blob(['<ServiceException>fout</ServiceException>'], { type: 'text/xml' })) });
      }
      return Promise.resolve({ ok: true, blob: () => Promise.resolve(
        new win.Blob([nepPng], { type: 'image/png' })) });
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

  const LAT = 52.1826, LON = 5.3421;   // Sikkelkruid 20, Amersfoort

  await test('Kandidatenlijst heeft meerdere varianten', () => {
    const k = w.kaartKandidaten(LAT, LON, 720, 300, 0.0035);
    return k.length >= 4 ? k.length + ' varianten' : false;
  });
  await test('Eerste kandidaat is Web Mercator', () => {
    const k = w.kaartKandidaten(LAT, LON, 720, 300, 0.0035);
    return k[0].url.includes('CRS=EPSG:3857') ? 'EPSG:3857' : k[0].url.slice(0, 90);
  });
  await test('Er is een 1.1.1-variant met SRS', () => {
    const k = w.kaartKandidaten(LAT, LON, 720, 300, 0.0035);
    return k.some(x => x.url.includes('VERSION=1.1.1') && x.url.includes('SRS=EPSG:4326'));
  });
  await test('Er is een luchtfoto-terugval', () => {
    const k = w.kaartKandidaten(LAT, LON, 720, 300, 0.0035);
    return k.some(x => x.url.includes('luchtfotorgb'));
  });
  await test('Aspectcorrectie voor lengtegraden', () => {
    const k = w.kaartKandidaten(LAT, LON, 720, 300, 0.0035);
    const m = k[1].url.match(/BBOX=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/);
    const dLat = (parseFloat(m[3]) - parseFloat(m[1])) / 2;
    const dLon = (parseFloat(m[4]) - parseFloat(m[2])) / 2;
    const verhouding = dLon / dLat;
    // Verwacht (720/300) / cos(52,18°) ≈ 3,92
    return Math.abs(verhouding - 3.92) < 0.15 ? 'verhouding ' + verhouding.toFixed(2) : verhouding.toFixed(2);
  });

  await test('Kaart wordt opgehaald en ingesloten', async () => {
    const r = await w.laadKaart(LAT, LON, 720, 300);
    return r && r.url.startsWith('data:image/png;base64,') ? 'data-URI van ' + r.url.length + ' tekens' : false;
  });
  await test('Bronvermelding meegeleverd', () => w.kaartHTML(LAT, LON, 720).includes('Kadaster / PDOK'));
  await test('kaartHTML sluit de afbeelding in (geen externe URL)', () => {
    const h = w.kaartHTML(LAT, LON, 720);
    return h.includes('src="data:image/png') && !h.includes('service.pdok.nl') ? 'ingesloten' : false;
  });

  await test('Terugval naar volgende kandidaat bij WMS-fout', async () => {
    verzoeken.length = 0;
    slaagtVanaf = 2;                       // eerste twee mislukken
    const r = await w.laadKaart(LAT, LON, 400, 200);
    return r && verzoeken.length === 3 ? 'geslaagd bij kandidaat 3' : (r ? verzoeken.length : false);
  });

  await test('Nette melding als alle kandidaten falen', async () => {
    verzoeken.length = 0;
    slaagtVanaf = 99;                      // alles mislukt
    await w.laadKaart(LAT, LON, 400, 200);
    const h = w.kaartHTML(LAT, LON, 400);
    return h.includes('map-leeg') && h.includes('openstreetmap.org') && !h.includes('<img')
      ? 'verwijzing in plaats van leeg kader' : h.slice(0, 80);
  });
  await test('Coördinaten in de melding, NL-notatie', () => {
    const h = w.kaartHTML(LAT, LON, 400);
    return h.includes('52,18260') ? '52,18260' : h.match(/Co.rdinaten: [^—]+/)?.[0];
  });

  // Resultaat direct tonen
  await test('switchTab naar resultaat werkt', () => {
    w.switchTab('resultaat');
    return d.getElementById('tab-resultaat').classList.contains('active');
  });
  await test('Verdiepingsnavigatie aanwezig', () => {
    const h = d.getElementById('resultaat-panel').innerHTML;
    return h.includes('verdiep-btn') ? (h.match(/verdiep-btn/g).length) + ' knoppen' : false;
  });
  await test('Verdiepingsknoppen tonen deelscores', () => {
    const h = d.getElementById('resultaat-panel').innerHTML;
    return h.includes('vb-score');
  });
  await test('Verdiepingsknop opent het juiste tabblad', () => {
    const knoppen = d.querySelectorAll('.verdiep-btn');
    knoppen[1].dispatchEvent(new w.Event('click'));
    return d.getElementById('tab-bouwkundig').classList.contains('active');
  });

  // Printrapport met kaart (coordinaten zetten via de state)
  await test('Coordinaten via state ingesteld', () => {
    w.pasStateToe({ velden: { adres: 'Sikkelkruid 20, 3824PN Amersfoort' }, lat: LAT, lon: LON });
    return d.getElementById('adres').value.includes('Sikkelkruid');
  });
  await test('Kaart verschijnt in het resultaat', async () => {
    slaagtVanaf = 0;
    await w.laadKaart(LAT, LON, 720, 300);
    w.switchTab('resultaat');
    const h = d.getElementById('resultaat-panel').innerHTML;
    return h.includes('map-wrap') && h.includes('src="data:image/png') ? 'ingesloten in resultaat' : false;
  });
  await test('Printrapport sluit de kaart in', async () => {
    slaagtVanaf = 0;
    await w.laadKaart(LAT, LON, 720, 300);
    w.switchTab('resultaat');
    let uit = null;
    w.open = () => ({ document: { write: t => { uit = t; }, close(){} }, focus(){}, print(){} });
    w.printRapport();
    return uit.includes('src="data:image/png') ? 'ingesloten in rapport' : false;
  });
  await test('Printrapport zonder kaart toont melding', async () => {
    slaagtVanaf = 99;
    await w.laadKaart(LAT, LON, 720, 300);
    let uit = null;
    w.open = () => ({ document: { write: t => { uit = t; }, close(){} }, focus(){}, print(){} });
    w.printRapport();
    return uit.includes('kon niet worden opgehaald') && !uit.includes('<img src="data:') ? 'nette melding' : false;
  });

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 700);
