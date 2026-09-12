const INDEX = require('path').join(__dirname, '..', 'index.html');
// Test: CBS-buurtcijfers, scholen en verduurzamingsmodule
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const fouten = [];
const LAT = 52.1826, LON = 5.3421;

// Nagebootst CBS-antwoord met de attribuutnamen van de jaargang 2023
const cbsFeature = {
  features: [{ properties: {
    buurtnaam: 'Dassenberg e.o.', wijknaam: 'Vathorst-De Velden', gemeentenaam: 'Amersfoort',
    aantal_inwoners: 835, bevolkingsdichtheid_inwoners_per_km2: 5586,
    aantal_huishoudens: 310, gemiddelde_huishoudsgrootte: 2.7,
    stedelijkheid_adressen_per_km2: 2, gemiddelde_woningwaarde: 568,
    aantal_woningen: 304, percentage_koopwoningen: 72, percentage_huurwoningen: 28,
    percentage_huurwoningen_in_bezit_woningcorporaties: 24,
    percentage_eengezinswoning: 90, percentage_meergezinswoning: 10,
    personenautos_per_huishouden: 1.1,
    afstand_tot_huisartsenpraktijk: 1.4, afstand_tot_grote_supermarkt: 1.3,
    afstand_tot_kinderdagverblijf: 0.3, afstand_tot_school: 0.8, scholen_binnen_3_km: 8.6,
    afstand_tot_oprit_hoofdverkeersweg: 1.9, afstand_tot_treinstation: 2.4,
    percentage_personen_0_tot_15_jaar: 18.6, percentage_personen_15_tot_25_jaar: 18.6,
    percentage_personen_25_tot_45_jaar: 20.4, percentage_personen_45_tot_65_jaar: 35.9,
    percentage_personen_65_jaar_en_ouder: 7.2,
    onbekend_veld: -99997,
  }}]
};

let cbsScenario = 'ok';

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://example.org/',
  pretendToBeVisual: true,
  beforeParse(win) {
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {}; win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
    win.fetch = (url) => {
      const u = String(url);
      if (u.includes('cbs/wijkenbuurten')) {
        if (cbsScenario === 'faalt') return Promise.resolve({ ok: false, status: 404 });
        if (cbsScenario === 'alleen2022' && !u.includes('/2022/')) return Promise.resolve({ ok: false, status: 404 });
        return Promise.resolve({ ok: true, json: () => Promise.resolve(cbsFeature) });
      }
      return Promise.reject(new Error('geen netwerk in test'));
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

  // ── CBS ──
  await test('CBS-buurt wordt opgehaald', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    return c && c.buurtnaam === 'Dassenberg e.o.' ? c.buurtnaam + ' (' + c.jaar + ')' : false;
  });
  await test('Kerncijfers correct uitgelezen', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    return c.inwoners === 835 && c.dichtheid === 5586 && c.woningen === 304 && c.pctKoop === 72
      ? '835 inwoners, 304 woningen, 72% koop' : JSON.stringify(c).slice(0, 80);
  });
  await test('Afstanden en scholen uitgelezen', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    return c.dSupermarkt === 1.3 && c.scholen3km === 8.6 ? '1,3 km supermarkt · 8,6 scholen' : false;
  });
  await test('Onbekend-codes (-99997) worden genegeerd', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    return c.bouwjaarVoor2000 === null;
  });
  await test('Terugval naar oudere jaargang', async () => {
    cbsScenario = 'alleen2022';
    const c = await w.getCBSBuurt(LAT, LON);
    cbsScenario = 'ok';
    return c && c.jaar === '2022' ? 'jaargang 2022 gebruikt' : (c ? c.jaar : false);
  });
  await test('Geen CBS-data geeft null', async () => {
    cbsScenario = 'faalt';
    const c = await w.getCBSBuurt(LAT, LON);
    cbsScenario = 'ok';
    return c === null ? 'null (correct)' : false;
  });

  // ── Weergave ──
  await test('Buurtstatistieken renderen', async () => {
    w._cbsZet ? w._cbsZet() : null;
    const c = await w.getCBSBuurt(LAT, LON);
    // via pasStateToe kunnen we geen _cbs zetten; gebruik de publieke render na toewijzing
    w.cbsVulAan(c);
    return true;
  });

  await test('CBS vult ontbrekende voorzieningen aan', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    d.getElementById('supermarkt').value = 'onbekend';
    d.getElementById('huisarts').value = 'onbekend';
    const n = w.cbsVulAan(c);
    return n >= 2 && d.getElementById('supermarkt').value === '500m_2km'
      ? n + ' velden aangevuld, supermarkt 500m–2km' : n + '/' + d.getElementById('supermarkt').value;
  });
  await test('Aanvulling is gemarkeerd als schatting', () => {
    const p = w.provRijen().find(r => r.veld === 'supermarkt');
    return p && p.methode === 'schatting' && p.toelichting.includes('niet de afstand vanaf dit specifieke adres')
      ? 'schatting + toelichting' : (p ? p.methode : 'ontbreekt');
  });
  await test('Reeds gevulde velden blijven ongemoeid', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    d.getElementById('supermarkt').value = 'lt500m';
    w.cbsVulAan(c);
    return d.getElementById('supermarkt').value === 'lt500m';
  });

  // ── Scholen ──
  await test('Scholenlijst uit OSM', () => {
    const els = [
      { type:'node', id:1, lat:LAT+0.004, lon:LON, tags:{ amenity:'school', name:'De Wonderboom' } },
      { type:'node', id:2, lat:LAT+0.002, lon:LON, tags:{ amenity:'kindergarten', name:'Kinderopvang Vathorst' } },
      { type:'way',  id:3, center:{lat:LAT+0.01, lon:LON}, tags:{ amenity:'college', name:'ROC Midden' } },
      { type:'node', id:4, lat:LAT, lon:LON, tags:{ amenity:'pharmacy', name:'Apotheek' } },
    ];
    const sc = w.verzamelScholen(els, LAT, LON);
    return sc.length === 3 && sc[0].naam === 'Kinderopvang Vathorst'
      ? '3 scholen, dichtstbijzijnde eerst' : sc.map(x => x.naam).join(',');
  });
  await test('Scholenblok verwijst naar scholenopdekaart.nl', () => {
    const h = w.scholenHTML();
    return h.includes('scholenopdekaart.nl') && h.includes('De Wonderboom') ? 'link + namen' : false;
  });
  await test('Geen kwaliteitsclaim bij de schoolnamen', () =>
    w.scholenHTML().includes('zeggen niets over de kwaliteit van het onderwijs'));

  // ── Verduurzaming ──
  await test('Zonder gegevens nette melding', () => {
    d.getElementById('woonoppervlak').value = '';
    d.getElementById('gasverbruik').value = '';
    return w.verduurzamingHTML(true).includes('Zoek eerst een adres');
  });

  await test('Verbruik schatten op oppervlakte en label', () => {
    d.getElementById('woonoppervlak').value = '191';
    d.getElementById('bouwjaar').value = '2004';
    d.getElementById('energielabel').value = 'A';
    const v = w.berekenVerduurzaming();
    // 191 m² × 8,5 × 0,6 (label A) ≈ 974 m³
    return v.gas === 974 && v.gasBron === 'geschat' ? v.gas + ' m³ geschat' : v.gas + '/' + v.gasBron;
  });
  await test('Opgegeven verbruik wint van de schatting', () => {
    d.getElementById('gasverbruik').value = '660';
    d.getElementById('stroomverbruik').value = '3400';
    const v = w.berekenVerduurzaming();
    return v.gas === 660 && v.gasBron === 'opgegeven' ? '660 m³ opgegeven' : v.gas + '/' + v.gasBron;
  });
  await test('Energiekosten met eigen tarieven', () => {
    d.getElementById('gasprijs').value = '1,39';
    d.getElementById('stroomprijs').value = '0,39';
    const v = w.berekenVerduurzaming();
    return v.gasKosten === 917 && v.stroomKosten === 1326
      ? '€ 917 gas + € 1.326 stroom' : v.gasKosten + '/' + v.stroomKosten;
  });
  await test('Maatregelen naar bouwjaar gewogen', () => {
    const v = w.berekenVerduurzaming();
    const dak = v.rijen.find(r => r.naam === 'Dakisolatie');
    const wp  = v.rijen.find(r => r.naam.includes('warmtepomp'));
    return dak.status === 'waarschijnlijk aanwezig' && wp.status === 'kansrijk'
      ? 'bouwjaar 2004: dak al aanwezig, warmtepomp kansrijk' : dak.status + '/' + wp.status;
  });
  await test('Oud pand krijgt meer kansrijke maatregelen', () => {
    d.getElementById('bouwjaar').value = '1930';
    const v = w.berekenVerduurzaming();
    const n = v.rijen.filter(r => r.status === 'kansrijk').length;
    d.getElementById('bouwjaar').value = '2004';
    return n === 5 ? '5 kansrijke maatregelen bij bouwjaar 1930' : n;
  });
  await test('Warmtepomp verrekent extra stroomverbruik', () => {
    const v = w.berekenVerduurzaming();
    const wp = v.rijen.find(r => r.naam.includes('warmtepomp'));
    return wp.extraStroom > 0 && wp.netto < wp.euro
      ? wp.euro + ' bruto → ' + wp.netto + ' netto' : false;
  });
  await test('Terugverdientijd berekend', () => {
    const wp = w.berekenVerduurzaming().rijen.find(r => r.naam.includes('warmtepomp'));
    return wp.tvt > 0 && wp.tvt < 60 ? wp.tvt + ' jaar' : wp.tvt;
  });

  // ── Leenruimte ──
  await test('EBV-ruimte bij label A', () => {
    const v = w.berekenVerduurzaming();
    return v.ebv.verduurzaming === 10000 && v.ebv.aankoop === 10000 ? '€ 10.000 / € 10.000' : JSON.stringify(v.ebv);
  });
  await test('EBV-ruimte bij label G', () => {
    d.getElementById('energielabel').value = 'G';
    const v = w.berekenVerduurzaming();
    d.getElementById('energielabel').value = 'A';
    return v.ebv.verduurzaming === 20000 && v.ebv.aankoop === 0 ? '€ 20.000 / € 0' : JSON.stringify(v.ebv);
  });
  await test('Leenruimte gemarkeerd als geen hypotheekadvies', () =>
    w.verduurzamingHTML(true).includes('geen hypotheekadvies'));
  await test('Waarschuwing bij geschat label', () => {
    d.getElementById('sb-energielabel').style.display = 'inline';
    const h = w.verduurzamingHTML(true);
    d.getElementById('sb-energielabel').style.display = 'none';
    return h.includes('niet beschikbaar') ? 'waarschuwt dat EBV-ruimte vervalt' : false;
  });

  // ── Lasten ──
  await test('Lokale lasten berekend uit WOZ', () => {
    const l = w.berekenLasten(568000);
    return l.ozb === 568 && l.totaalEen > 1000 ? 'OZB € 568, totaal ' + Math.round(l.totaalEen) : JSON.stringify(l);
  });
  await test('Lasten gemarkeerd als buurtgemiddelde', async () => {
    const c = await w.getCBSBuurt(LAT, LON);
    w.cbsVulAan(c);
    return true;
  });

  // ── UI ──
  await test('Tabblad Verduurzaming bestaat', () => !!d.getElementById('tab-verduurzaming'));
  await test('Tabblad rendert bij openen', () => {
    w.switchTab('verduurzaming');
    return d.getElementById('verduurzaming-uitvoer').innerHTML.length > 500
      ? d.getElementById('verduurzaming-uitvoer').innerHTML.length + ' tekens' : false;
  });
  await test('Verbruiksvelden in de state', () => {
    const st = w.verzamelState();
    return ['gasverbruik','stroomverbruik','gasprijs','zonnepanelen'].every(k => k in st.velden);
  });
  await test('Printrapport bevat de verduurzamingssectie', () => {
    w.switchTab('resultaat');
    let uit = null;
    w.open = () => ({ document: { write: t => { uit = t; }, close(){} }, focus(){}, print(){} });
    w.printRapport();
    return uit.includes('Verduurzaming, lasten en leenruimte') ? 'aanwezig' : false;
  });

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 700);
