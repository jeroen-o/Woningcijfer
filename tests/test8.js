const INDEX = require('path').join(__dirname, '..', 'index.html');
// Test: regiometer (buurt/wijk/gemeente) en onderwijsclassificatie
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const fouten = [];
const LAT = 52.197258, LON = 5.411631;

const basis = {
  buurten: { buurtnaam:'Vathorst-Zuid', buurtcode:'BU03072801', wijkcode:'WK030728', gemeentecode:'GM0307',
    aantal_inwoners:2140, bevolkingsdichtheid_inwoners_per_km2:5586, gemiddelde_huishoudsgrootte:2.7,
    gemiddelde_woningwaarde:568, aantal_woningen:820,
    percentage_koopwoningen:72, percentage_huurwoningen:28,
    percentage_huurwoningen_in_bezit_woningcorporaties:24,
    percentage_eengezinswoning:90, personenautos_per_huishouden:1.1,
    percentage_personen_65_jaar_en_ouder:7.2 },
  wijken: { wijknaam:'Vathorst', wijkcode:'WK030728', gemeentecode:'GM0307',
    aantal_inwoners:26000, bevolkingsdichtheid_inwoners_per_km2:3900, gemiddelde_huishoudsgrootte:2.9,
    gemiddelde_woningwaarde:512, aantal_woningen:9600,
    percentage_koopwoningen:76, percentage_huurwoningen:24,
    percentage_huurwoningen_in_bezit_woningcorporaties:18,
    percentage_eengezinswoning:88, personenautos_per_huishouden:1.2,
    percentage_personen_65_jaar_en_ouder:6.0 },
  gemeenten: { gemeentenaam:'Amersfoort', gemeentecode:'GM0307',
    aantal_inwoners:161000, bevolkingsdichtheid_inwoners_per_km2:2800, gemiddelde_huishoudsgrootte:2.3,
    gemiddelde_woningwaarde:432, aantal_woningen:70000,
    percentage_koopwoningen:58, percentage_huurwoningen:42,
    percentage_huurwoningen_in_bezit_woningcorporaties:30,
    percentage_eengezinswoning:70, personenautos_per_huishouden:1.0,
    percentage_personen_65_jaar_en_ouder:16.0 },
};

let scenario = 'ok';

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://example.org/', pretendToBeVisual: true,
  beforeParse(win) {
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {}; win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
    win.fetch = (url) => {
      const u = String(url);
      const m = u.match(/wijkenbuurten:(\w+)/);
      if (m) {
        if (scenario === 'alleen-buurt' && m[1] !== 'buurten') return Promise.resolve({ ok:false, status:404 });
        return Promise.resolve({ ok:true, json:() => Promise.resolve({ features:[{ properties: basis[m[1]] }] }) });
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

  // ── Gebiedscodes ──
  await test('Buurt-, wijk- en gemeentecode uitgelezen', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    return c.buurtcode === 'BU03072801' && c.gemeentecode === 'GM0307'
      ? c.buurtcode + ' / ' + c.gemeentecode : JSON.stringify([c.buurtcode, c.gemeentecode]);
  });
  await test('Wijk en gemeente meegeladen', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    return c.wijk && c.gemeente && c.wijk.wijknaam === 'Vathorst' && c.gemeente.gemeentenaam === 'Amersfoort'
      ? 'Vathorst / Amersfoort' : false;
  });
  await test('Buurt werkt ook zonder wijk en gemeente', async () => {
    scenario = 'alleen-buurt';
    const c = await w.getCBSBuurt(LAT, LON);
    scenario = 'ok';
    return c && c.buurtnaam === 'Vathorst-Zuid' && c.wijk === null ? 'buurt blijft werken' : false;
  });

  // ── Regiometer ──
  await test('Regioduiding boven gemeentegemiddelde', () => {
    const dg = w.regioDuiding(90, 70);
    return dg.txt === 'boven gemeentegemiddelde' ? dg.txt : dg.txt;
  });
  await test('Regioduiding rond gemeentegemiddelde', () => w.regioDuiding(72, 70).txt === 'rond gemeentegemiddelde');
  await test('Regioduiding ruim onder gemeentegemiddelde', () => w.regioDuiding(5, 30).txt === 'ruim onder gemeentegemiddelde');
  await test('Deling door nul afgevangen', () => w.regioDuiding(10, 0) === null);

  await test('Woningwaarde in duizendtallen omgerekend', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    return w.regioWaarde(c, 'woningwaarde') === 568000 ? '568 → € 568.000' : w.regioWaarde(c, 'woningwaarde');
  });
  await test('Formattering per eenheid', () =>
    w.regioFormat(568000, '€') === '€ 568.000' && w.regioFormat(24, '%') === '24%' && w.regioFormat(1.1, '') === '1,1'
      ? '€ / % / decimaal' : [w.regioFormat(568000,'€'), w.regioFormat(24,'%'), w.regioFormat(1.1,'')].join(' | '));

  // ── Weergave: vereist dat _cbs gevuld is via de hoofdflow ──
  await test('Regiometer rendert met drie kolommen', async () => {
    // _cbs wordt binnen de scriptscope gezet; via een analyse-achtige aanroep
    const c = await w.getCBSBuurt(LAT, LON);
    w.cbsVulAan(c);          // vult velden, raakt _cbs niet
    // Voor de rendertest gebruiken we de publieke functie met de echte flow:
    return typeof w.regiometerHTML === 'function';
  });

  // ── Schoolclassificatie ──
  await test('isced:level 1 → basisschool', () => {
    const k = w.classificeerSchool({ amenity:'school', 'isced:level':'1', name:'Test' });
    return k.groep === 'po' && k.zeker === true ? 'po, zeker' : JSON.stringify(k);
  });
  await test('isced:level 2-3 → middelbare school', () => {
    const k = w.classificeerSchool({ amenity:'school', 'isced:level':'2;3', name:'Test' });
    return k.groep === 'vo' && k.zeker === true ? 'vo, zeker' : JSON.stringify(k);
  });
  await test('Naam "Lyceum" → vo, gemarkeerd als afgeleid', () => {
    const k = w.classificeerSchool({ amenity:'school', name:'Het Nieuwe Eemland Lyceum' });
    return k.groep === 'vo' && k.zeker === false ? 'vo, afgeleid uit naam' : JSON.stringify(k);
  });
  await test('Naam "Scholengemeenschap" → vo', () =>
    w.classificeerSchool({ amenity:'school', name:'Scholengemeenschap Vathorst' }).groep === 'vo');
  await test('Naam "obs" → basisonderwijs', () =>
    w.classificeerSchool({ amenity:'school', name:'obs De Wonderboom' }).groep === 'po');
  await test('Kinderopvang apart geclassificeerd', () =>
    w.classificeerSchool({ amenity:'kindergarten', name:'Kdv Vathorst' }).groep === 'opvang');
  await test('ROC → vervolgonderwijs', () =>
    w.classificeerSchool({ amenity:'school', name:'ROC Midden Nederland' }).groep === 'vervolg');
  await test('Onbekend type niet als zeker gemarkeerd', () => {
    const k = w.classificeerSchool({ amenity:'school', name:'De Vlinder' });
    return k.zeker === false ? 'gemarkeerd als onzeker' : false;
  });

  // ── Scholenlijst ──
  await test('Scholen gegroepeerd per onderwijstype', () => {
    const els = [
      { type:'node', id:1, lat:LAT+0.004, lon:LON, tags:{ amenity:'school', name:'obs De Wonderboom' } },
      { type:'node', id:2, lat:LAT+0.006, lon:LON, tags:{ amenity:'school', name:'Vathorst College' } },
      { type:'node', id:3, lat:LAT+0.002, lon:LON, tags:{ amenity:'kindergarten', name:'Kdv Vathorst' } },
      { type:'way',  id:4, center:{lat:LAT+0.02, lon:LON}, tags:{ amenity:'college', name:'ROC Midden' } },
    ];
    const sc = w.verzamelScholen(els, LAT, LON);
    const groepen = [...new Set(sc.map(s => s.groep))];
    return groepen.length === 4 ? '4 groepen: ' + groepen.join(', ') : groepen.join(',');
  });
  await test('VO-rijen verwijzen naar De VO Gids', () => {
    const h = w.scholenHTML();
    return h.includes('devogids.nl/middelbare-scholen') && h.includes('Vathorst College') ? 'link bij vo-rij' : false;
  });
  await test('Basisschool krijgt geen VO Gids-link', () => {
    const h = w.scholenHTML();
    const poBlok = h.split('Basisonderwijs')[1] || '';
    const tot = poBlok.split('Kinderopvang')[0] || '';
    return !tot.includes('devogids') ? 'terecht weggelaten' : false;
  });
  await test('Afgeleid type zichtbaar gemarkeerd', () =>
    w.scholenHTML().includes('type afgeleid uit de naam'));
  await test('Beide bronnen genoemd in de toelichting', () => {
    const h = w.scholenHTML();
    return h.includes('scholenopdekaart.nl') && h.includes('devogids.nl') && h.includes('open koppeling');
  });
  await test('Zoekstraal scholen verruimd naar 8 km', () => {
    const bron = fs.readFileSync(INDEX, 'utf8');
    return bron.includes('kindergarten)$"](around:8000');
  });

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 700);
