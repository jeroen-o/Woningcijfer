// Test: waarom de kolommen wijk en gemeente leeg kunnen blijven
const INDEX = require('path').join(__dirname, '..', 'index.html');
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const fouten = [];
const verzoeken = [];
const LAT = 52.20360, LON = 5.51420;

const buurt = { buurtnaam:'Nijkerkerveen', buurtcode:'BU02670503',
  wijkcode:'WK026705', gemeentecode:'GM0267',
  aantal_inwoners: 4120, aantal_woningen: 1580,
  percentage_koopwoningen: 78, gemiddelde_woningwaarde: 412,
  gemiddeld_inkomen_per_inwoner: 31.2, percentage_huishoudens_onder_of_rond_sociaal_minimum: 3 };

const wijkVol = { wijknaam:'Nijkerkerveen', wijkcode:'WK026705', gemeentecode:'GM0267',
  aantal_inwoners: 4120, aantal_woningen: 1580, percentage_koopwoningen: 78,
  gemiddelde_woningwaarde: 412, gemiddeld_inkomen_per_inwoner: 31.2 };

// Jaargang die op wijk- en gemeenteniveau alleen naam, code en geometrie geeft
const wijkKaal = { wijknaam:'Nijkerkerveen', wijkcode:'WK026705', gemeentecode:'GM0267' };
const gemKaal  = { gemeentenaam:'Nijkerk', gemeentecode:'GM0267' };

const gemVol = { gemeentenaam:'Nijkerk', gemeentecode:'GM0267',
  aantal_inwoners: 44800, aantal_woningen: 17200, percentage_koopwoningen: 71,
  gemiddelde_woningwaarde: 389, gemiddeld_inkomen_per_inwoner: 29.4 };

let scenario = 'volledig';

const dom = new JSDOM(html, {
  runScripts:'dangerously', url:'https://example.org/', pretendToBeVisual:true,
  beforeParse(win) {
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {}; win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
    win.fetch = (url) => {
      const u = decodeURIComponent(String(url));
      verzoeken.push(u);
      const ok = o => Promise.resolve({ ok:true, json:() => Promise.resolve(o) });
      const m = u.match(/wijkenbuurten:(\w+)/);
      if (!m) return Promise.reject(new Error('geen netwerk'));
      const laag = m[1];
      const opCode = u.includes('filter=');

      if (laag === 'buurten') return ok({ features:[{ properties: buurt }] });

      if (scenario === 'geen-vergelijking') return ok({ features: [] });
      if (scenario === 'kaal') {
        return ok({ features:[{ properties: laag === 'wijken' ? wijkKaal : gemKaal }] });
      }
      if (scenario === 'alleen-bbox' && opCode) {
        // Het filter op code werkt niet in deze jaargang
        return Promise.resolve({ ok:false, status:400 });
      }
      return ok({ features:[{ properties: laag === 'wijken' ? wijkVol : gemVol }] });
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

  // ── Ophaalroute ──
  await test('Wijk en gemeente worden op code opgehaald', async () => {
    scenario = 'volledig'; verzoeken.length = 0;
    const c = await w.getCBSBuurt(LAT, LON);
    const opCode = verzoeken.filter(u => u.includes('filter=') && u.includes('wijkenbuurten')).length;
    return c.wijk && c.gemeente && opCode === 2
      ? 'beide via een codefilter' : 'wijk=' + !!c.wijk + ', gem=' + !!c.gemeente + ', filters=' + opCode;
  });
  await test('Codeveld vastgelegd in het resultaat', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    return c.wijk.viaCode === 'wijkcode' && c.gemeente.viaCode === 'gemeentecode'
      ? 'wijkcode en gemeentecode' : c.wijk.viaCode + '/' + c.gemeente.viaCode;
  });
  await test('Cijfers van wijk en gemeente uitgelezen', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    return c.wijk.inwoners === 4120 && c.gemeente.inwoners === 44800
      ? '4.120 / 44.800 inwoners' : c.wijk.inwoners + '/' + c.gemeente.inwoners;
  });
  await test('Terugval op bbox als het codefilter faalt', async () => {
    scenario = 'alleen-bbox';
    const c = await w.getCBSBuurt(LAT, LON);
    scenario = 'volledig';
    return c.wijk && c.gemeente && !c.wijk.viaCode
      ? 'via locatie opgehaald' : 'wijk=' + !!c.wijk + ', gem=' + !!c.gemeente;
  });

  // ── De oorzaak van lege kolommen ──
  await test('Laag zonder kerncijfers wordt niet meer weggegooid', async () => {
    scenario = 'kaal';
    const c = await w.getCBSBuurt(LAT, LON);
    scenario = 'volledig';
    return c.wijk && c.wijk.wijknaam === 'Nijkerkerveen' && c.wijk.statistieken === false
      ? 'naam bewaard, statistieken:false' : JSON.stringify(c.wijk);
  });
  await test('Reden bij een kale laag', () => {
    const r = w.regioLeegReden({ statistieken:false, wijknaam:'x' }, 'wijk');
    return r && r.includes('alleen naam en code') ? r : String(r);
  });
  await test('Reden bij een ontbrekende laag', () => {
    const r = w.regioLeegReden(null, 'gemeente');
    return r === 'de gemeentegegevens konden niet worden opgehaald' ? r : String(r);
  });
  await test('Geen reden bij een volledige laag', () =>
    w.regioLeegReden({ statistieken:true, inwoners:100 }, 'wijk') === null);

  // ── Weergave ──
  await test('Regiometer verschijnt ook zonder vergelijkingscijfers', () => {
    return html.includes('const heeftVergelijking') ? 'buurtkolom blijft staan' : false;
  });
  await test('Uitleg bij lege kolommen ingebouwd', () =>
    html.includes('staat leeg omdat') && html.includes('De buurtcijfers zijn wel volledig')
      ? 'melding aanwezig' : false);
  await test('Inkomenstabel krijgt dezelfde uitleg', () => {
    const i = html.indexOf('function inkomenHTML');
    const blok = html.slice(i, html.indexOf('\n// ═', i));
    return blok.includes('staat leeg omdat') ? 'ook bij inkomen' : false;
  });

  // ── Herkomsttabel ──
  await test('Wijk en gemeente apart in de herkomst', () =>
    html.includes("registerBron('regio_' + soort") && html.includes("'Wijkcijfers'")
      && html.includes("'Gemeentecijfers'") ? 'twee aparte regels' : false);
  await test('Kale laag krijgt status mislukt met uitleg', () =>
    html.includes('zonder kerncijfers') && html.includes('De vergelijkingskolom blijft daarom leeg')
      ? 'gemarkeerd als niet opgehaald' : false);
  await test('Ontbrekende code wordt benoemd', () =>
    html.includes('geen code bekend uit de buurtgegevens'));

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 800);
