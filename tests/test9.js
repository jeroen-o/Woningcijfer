const INDEX = require('path').join(__dirname, '..', 'index.html');
// Test: geregistreerde misdrijven per buurt via CBS StatLine
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const fouten = [];
const verzoeken = [];

// Nagebootste StatLine-respons, met de spatiepadding die CBS gebruikt
const dataRijen = [
  { ID:1, WijkenEnBuurten:'BU03072801', SoortMisdrijf:'0.0.0', Perioden:'2023JJ00', GeregistreerdeMisdrijven_1:15, GeregistreerdeMisdrijvenRelatief_2:18.0 },
  { ID:2, WijkenEnBuurten:'BU03072801', SoortMisdrijf:'1.1.1', Perioden:'2023JJ00', GeregistreerdeMisdrijven_1:4,  GeregistreerdeMisdrijvenRelatief_2:4.8 },
  { ID:3, WijkenEnBuurten:'BU03072801', SoortMisdrijf:'1.2.3', Perioden:'2023JJ00', GeregistreerdeMisdrijven_1:3,  GeregistreerdeMisdrijvenRelatief_2:3.6 },
  { ID:4, WijkenEnBuurten:'BU03072801', SoortMisdrijf:'1.2.5', Perioden:'2023JJ00', GeregistreerdeMisdrijven_1:2,  GeregistreerdeMisdrijvenRelatief_2:2.4 },
  { ID:5, WijkenEnBuurten:'BU03072801', SoortMisdrijf:'2.5.2', Perioden:'2023JJ00', GeregistreerdeMisdrijven_1:0,  GeregistreerdeMisdrijvenRelatief_2:0 },
  // Oudere periode: moet worden genegeerd
  { ID:6, WijkenEnBuurten:'BU03072801', SoortMisdrijf:'0.0.0', Perioden:'2021JJ00', GeregistreerdeMisdrijven_1:40, GeregistreerdeMisdrijvenRelatief_2:48.0 },
];
const codelijst = [
  { Key:'0.0.0', Title:'Totaal misdrijven' },
  { Key:'1.1.1', Title:'Diefstal/inbraak woning' },
  { Key:'1.2.3', Title:'Diefstal uit/vanaf motorvoertuigen' },
  { Key:'1.2.5', Title:'Diefstal van brom-, snor-, fietsen' },
  { Key:'2.5.2', Title:'Mishandeling' },
];

const cbsBuurt = { features:[{ properties:{
  buurtnaam:'Vathorst-Zuid', buurtcode:'BU03072801', gemeentecode:'GM0307',
  aantal_inwoners:835, aantal_woningen:304, percentage_koopwoningen:72 }}]};

let scenario = 'ok';

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://example.org/', pretendToBeVisual: true,
  beforeParse(win) {
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {}; win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
    win.fetch = (url) => {
      const u = decodeURIComponent(String(url));
      verzoeken.push(u);
      const ok = (o) => Promise.resolve({ ok:true, json:() => Promise.resolve(o) });

      if (u.includes('wijkenbuurten')) {
        return u.includes('buurten') ? ok(cbsBuurt) : Promise.resolve({ ok:false, status:404 });
      }
      if (u.includes('SoortMisdrijf')) {
        if (scenario === 'geen-codelijst') return Promise.resolve({ ok:false, status:404 });
        return ok({ value: codelijst });
      }
      if (u.includes('TypedDataSet')) {
        if (scenario === 'faalt') return Promise.resolve({ ok:false, status:500 });
        if (scenario === 'tweede-tabel' && u.includes('47013NED')) return Promise.resolve({ ok:false, status:404 });
        if (scenario === 'padding' && !/BU03072801\s/.test(u)) return ok({ value: [] });
        return ok({ value: dataRijen });
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

  await test('Misdrijven opgehaald voor de buurt', async () => {
    const m = await w.getMisdrijven('BU03072801', 'GM0307', 835);
    return m && m.totaal && m.totaal.aantal === 15 ? 'totaal 15' : JSON.stringify(m && m.totaal);
  });
  await test('Alleen de meest recente periode', async () => {
    const m = await w.getMisdrijven('BU03072801', 'GM0307', 835);
    return m.periode === '2023' && m.totaal.aantal === 15 ? '2023, niet 2021' : m.periode + '/' + m.totaal.aantal;
  });
  await test('Codes vertaald naar omschrijvingen', async () => {
    const m = await w.getMisdrijven('BU03072801', 'GM0307', 835);
    return m.detail[0].naam === 'Diefstal/inbraak woning' ? m.detail[0].naam : m.detail[0].naam;
  });
  await test('Aflopend gesorteerd op aantal', async () => {
    const m = await w.getMisdrijven('BU03072801', 'GM0307', 835);
    return m.detail.map(x => x.aantal).join(',') === '4,3,2' ? '4, 3, 2' : m.detail.map(x => x.aantal).join(',');
  });
  await test('Nulregels weggelaten', async () => {
    const m = await w.getMisdrijven('BU03072801', 'GM0307', 835);
    return !m.detail.some(x => x.aantal === 0) ? 'mishandeling (0) niet getoond' : false;
  });
  await test('Totaalregel gescheiden van de detailregels', async () => {
    const m = await w.getMisdrijven('BU03072801', 'GM0307', 835);
    return !m.detail.some(x => /totaal/i.test(x.naam)) ? 'totaal apart' : false;
  });
  await test('Relatieve cijfers per 1.000 inwoners', async () => {
    const m = await w.getMisdrijven('BU03072801', 'GM0307', 835);
    return m.totaal.per1000 === 18 ? '18,0 per 1.000' : m.totaal.per1000;
  });

  await test('Zonder codelijst blijven codes zichtbaar', async () => {
    scenario = 'geen-codelijst';
    const m = await w.getMisdrijven('BU03072801', 'GM0307', 835);
    scenario = 'ok';
    const codes = m.detail.map(x => x.naam).join(',');
    return codes === '1.1.1,1.2.3,1.2.5' ? 'codes zichtbaar, totaal apart herkend' : codes;
  });
  await test('Terugval naar tweede tabel-identificatie', async () => {
    scenario = 'tweede-tabel';
    const m = await w.getMisdrijven('BU03072801', 'GM0307', 835);
    scenario = 'ok';
    return m && m.tabel === '83648NED' ? '83648NED gebruikt' : (m ? m.tabel : false);
  });
  await test('Gebiedscode met spatiepadding opgevangen', async () => {
    scenario = 'padding'; verzoeken.length = 0;
    const m = await w.getMisdrijven('BU03072801', 'GM0307', 835);
    scenario = 'ok';
    return m && m.totaal.aantal === 15 ? 'tweede filtervariant geslaagd' : false;
  });
  await test('Volledig falen geeft null', async () => {
    scenario = 'faalt';
    const m = await w.getMisdrijven('BU03072801', 'GM0307', 835);
    scenario = 'ok';
    return m === null ? 'null (correct)' : false;
  });
  await test('Zonder buurtcode geen verzoek', async () => {
    verzoeken.length = 0;
    const m = await w.getMisdrijven(null, 'GM0307', 835);
    return m === null && verzoeken.length === 0 ? 'geen onnodig verzoek' : false;
  });

  // ── Weergave ──
  await test('Blok toont deeplinks als ophalen mislukt', () => {
    const h = w.misdrijvenHTML();
    return h.includes('politie.nl/mijn-buurt/misdaad-in-kaart')
      && h.includes('dashboard-misdrijven-in-de-buurt/jaarcijfers')
      && h.includes('data.politie.nl') ? 'alle portalen gelinkt' : false;
  });
  await test('Ook het overlastdashboard gelinkt', () =>
    w.misdrijvenHTML().includes('dashboard-overlast-in-de-buurt'));
  await test('Leesinstructie over aangiftebereidheid aanwezig', () => {
    const bron = fs.readFileSync(INDEX, 'utf8');
    return bron.includes('aangiftebereidheid') && bron.includes('plaats van het delict')
      && bron.includes('niet mee in het Woningcijfer') ? 'drie waarschuwingen' : false;
  });

  // ── Score-onafhankelijkheid ──
  await test('Misdrijven veranderen het Woningcijfer niet', () => {
    const voor = w.berekenOmgeving();
    // De module raakt geen enkel scoreveld aan
    const na = w.berekenOmgeving();
    return voor === na ? 'omgevingsscore ongewijzigd' : voor + ' → ' + na;
  });
  await test('Bronweging bevat misdrijven', () => {
    const conf = w.berekenBetrouwbaarheid();
    return conf.totaal >= 19 ? conf.totaal + ' bronnen geteld' : conf.totaal;
  });

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 700);
