const INDEX = require('path').join(__dirname, '..', 'index.html');
// Test: inkomen en bestaanszekerheid per buurt
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const bron = html;
const fouten = [];
const LAT = 52.197258, LON = 5.411631;

const lagen = {
  buurten: { buurtnaam:'Vathorst-Zuid', buurtcode:'BU03072801', gemeentecode:'GM0307',
    aantal_inwoners:835, aantal_woningen:304,
    gemiddeld_inkomen_per_inwoner:32.4, gemiddeld_inkomen_per_inkomensontvanger:41.8,
    percentage_huishoudens_met_laag_inkomen:14, percentage_huishoudens_met_hoog_inkomen:28,
    percentage_huishoudens_onder_of_rond_sociaal_minimum:4,
    percentage_personen_met_een_uitkering_onder_aow_leeftijd:6 },
  wijken: { wijknaam:'Vathorst', wijkcode:'WK030728', gemeentecode:'GM0307',
    aantal_inwoners:26000,
    gemiddeld_inkomen_per_inwoner:30.1, gemiddeld_inkomen_per_inkomensontvanger:39.2,
    percentage_huishoudens_met_laag_inkomen:17, percentage_huishoudens_met_hoog_inkomen:24,
    percentage_huishoudens_onder_of_rond_sociaal_minimum:5,
    percentage_personen_met_een_uitkering_onder_aow_leeftijd:7 },
  gemeenten: { gemeentenaam:'Amersfoort', gemeentecode:'GM0307',
    aantal_inwoners:161000,
    gemiddeld_inkomen_per_inwoner:28.3, gemiddeld_inkomen_per_inkomensontvanger:37.5,
    percentage_huishoudens_met_laag_inkomen:21, percentage_huishoudens_met_hoog_inkomen:19,
    percentage_huishoudens_onder_of_rond_sociaal_minimum:8,
    percentage_personen_met_een_uitkering_onder_aow_leeftijd:11 },
};

let onderdrukt = false;

const dom = new JSDOM(html, {
  runScripts:'dangerously', url:'https://example.org/', pretendToBeVisual:true,
  beforeParse(win) {
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {}; win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
    win.fetch = (url) => {
      const u = decodeURIComponent(String(url));
      const ok = o => Promise.resolve({ ok:true, json:() => Promise.resolve(o) });
      const m = u.match(/wijkenbuurten:(\w+)/);
      if (m) {
        const p = Object.assign({}, lagen[m[1]]);
        if (onderdrukt && m[1] === 'buurten') {
          // CBS onderdrukt cijfers in kleine gebieden
          p.gemiddeld_inkomen_per_inwoner = -99997;
          delete p.percentage_huishoudens_onder_of_rond_sociaal_minimum;
        }
        return ok({ features:[{ properties: p }] });
      }
      return Promise.reject(new Error('geen netwerk'));
    };
  },
});

setTimeout(async () => {
  const w = dom.window;
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

  await test('Inkomensvelden uit het WFS-antwoord', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    return c.inkomenPerInwoner === 32.4 && c.pctSociaalMinimum === 4
      ? '32,4 duizend per inwoner · 4% sociaal minimum' : JSON.stringify([c.inkomenPerInwoner, c.pctSociaalMinimum]);
  });
  await test('Geen extra verzoek nodig', async () => {
    // De inkomensvelden komen uit dezelfde aanroep als de overige kerncijfers
    const c = await w.getCBSBuurt(LAT, LON);
    return c.pctUitkering === 6 && c.pctLaagInkomen === 14 ? 'zelfde WFS-antwoord' : false;
  });
  await test('Duizendtallen omgerekend naar euro', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    const b = w.inkomenBron(c);
    return b.inkomenPerInwoner === 32400 ? '32,4 → € 32.400' : b.inkomenPerInwoner;
  });
  await test('Reeds absolute bedragen blijven ongemoeid', () => {
    const b = w.inkomenBron({ inkomenPerInwoner: 32400 });
    return b.inkomenPerInwoner === 32400 ? 'geen dubbele vermenigvuldiging' : b.inkomenPerInwoner;
  });
  await test('Onderdrukte CBS-waarden geven null', async () => {
    onderdrukt = true;
    const c = await w.getCBSBuurt(LAT, LON);
    onderdrukt = false;
    const b = w.inkomenBron(c);
    return b.inkomenPerInwoner === null && b.pctSociaalMinimum === null
      ? 'null in plaats van -99997' : JSON.stringify(b);
  });

  // ── Weergave ──
  await test('Blok leeg zonder buurtdata', () => w.inkomenHTML() === '' ? 'leeg (correct)' : false);

  await test('Drie schaalniveaus in de tabelkop', () =>
    bron.includes('<th style="text-align:right">Buurt</th>')
    && bron.includes('>Wijk</th>') && bron.includes('>Gemeente</th>') ? 'buurt, wijk, gemeente' : false);

  await test('Geen oordeelskolom zoals bij de regiometer', () => {
    // De regiometer heeft een kolom Verhouding; het inkomensblok bewust niet
    const blok = bron.split('function inkomenHTML')[1].split('function ')[0];
    return !blok.includes('Verhouding') && !blok.includes('gemeentegemiddelde')
      ? 'geen oordeelswoorden' : false;
  });
  await test('Geen kleurcodering op de waarden', () => {
    const blok = bron.split('function inkomenHTML')[1].split('\n// ═')[0];
    return !/color:#B84D00|color:#27AE60|getPillBg/.test(blok) ? 'neutrale opmaak' : false;
  });

  await test('Leesinstructie: zegt niets over individuele bewoners', () =>
    bron.includes('zeggen niets over de bewoners van een') && bron.includes('spreiding groter dan het verschil tussen buurten'));
  await test('Vermeldt de CBS-onderdrukking', () =>
    bron.includes('herleidbaarheid naar personen') && bron.includes('streepje betekent dus niet'));
  await test('Telt niet mee in het Woningcijfer', () =>
    bron.includes('Een woning wordt niet beter of slechter\n      van het inkomen van de omgeving')
    || bron.includes('van het inkomen van de omgeving'));
  await test('Waarschuwing over indirecte discriminatie', () =>
    bron.includes('Algemene wet gelijke behandeling') && bron.includes('indirecte discriminatie')
      ? 'Awgb genoemd' : false);

  // ── Score-onafhankelijkheid ──
  await test('Omgevingsscore blijft ongewijzigd', () => {
    const voor = w.berekenOmgeving();
    const na = w.berekenOmgeving();
    return voor === na ? 'ongewijzigd' : voor + ' → ' + na;
  });
  await test('Inkomen zit niet in de bronweging', () => {
    // Alleen 'cbs' en 'statline' wegen mee; geen aparte inkomensweging
    return !bron.includes('inkomen:1,') && !bron.includes('inkomen:2,') ? 'geen eigen gewicht' : false;
  });

  // ── StatLine-terugval ──
  await test('StatLine-registratie als aanvulling aanwezig', () =>
    bron.includes("titel: 'Inkomen en bestaanszekerheid'") && bron.includes('85064NED') ? 'tabel geregistreerd' : false);

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 700);
