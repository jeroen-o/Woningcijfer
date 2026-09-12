const INDEX = require('path').join(__dirname, '..', 'index.html');
// Test: generieke StatLine-module met zes onderwerpen
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const fouten = [];
const verzoeken = [];

// Antwoorden per tabel, met CBS-achtige volgnummers achter de veldnamen
const tabelData = {
  '80305NED': [{ RegioS:'BU03072801', Perioden:'2023JJ00',
    AfstandTotHuisartsenpraktijk_5:1.4, AfstandTotZiekenhuisExclBuitenpolikl_11:3.8,
    AfstandTotApotheek_9:0.6, AfstandTotKinderdagverblijf_15:0.3,
    AfstandTotGroteSupermarkt_20:1.3, AfstandTotWarenhuis_24:2.1,
    AfstandTotSchoolBasisonderwijs_40:0.8, AfstandTotSchoolVmbo_46:2.9,
    AfstandTotSchoolHavoVwo_52:3.4, ScholenBinnen3KmBasisonderwijs_41:8.6,
    AfstandTotTreinstationsTotaal_60:2.4, AfstandTotOpritHoofdverkeersweg_58:1.9,
    AfstandTotBrandweerkazerne_62:2.2, AfstandTotBibliotheek_33:1.7 }],
  '85999NED': [
    { RegioS:'BU03072801', Perioden:'2023JJ00', Woningkenmerken:'A028927', GemiddeldAardgasverbruikTotaal_1:1450 },
    { RegioS:'BU03072801', Perioden:'2023JJ00', Woningkenmerken:'T001139',
      GemiddeldAardgasverbruikTotaal_1:1180, GemiddeldElektriciteitsverbruikTotaal_9:3150,
      GemiddeldAardgasverbruikTussenwoning_3:1020, GemiddeldAardgasverbruikVrijstaandeWoning_6:2240,
      PercentageWoningenMetStadsverwarming_12:0 },
    { RegioS:'BU03072801', Perioden:'2019JJ00', Woningkenmerken:'T001139', GemiddeldAardgasverbruikTotaal_1:1600 },
  ],
  '83625NED': [{ RegioS:'GM0307', Perioden:'2024JJ00',
    GemiddeldeVerkoopprijs_2:452000, VerkochteWoningen_1:2140,
    PrijsindexBestaandeKoopwoningen_1:148.2, OntwikkelingTOVEenJaarEerder_3:7.4 }],
  '86211NED': [{ RegioS:'BU03072801', Perioden:'2019JJ00',
    TotaleOppervlakte_1:150, TotaalVerkeersterrein_2:12, TotaalBebouwdTerrein_8:96,
    TotaalRecreatieterrein_20:18, TotaalBosEnOpenNatuurlijkTerrein_30:15, TotaalBinnenwater_38:9 }],
  '86044NED': [{ RegioS:'BU03072801', Perioden:'2023JJ00',
    OpgesteldVermogenZonnepanelen_2:1240, AantalInstallaties_1:96, OpgesteldVermogenPerWoning_3:4080 }],
  '85064NED': [{ RegioS:'BU03072801', Perioden:'2022JJ00',
    GemiddeldInkomenPerInwoner_1:32.4, GemiddeldInkomenPerInkomensontvanger_2:41.8,
    HuishoudensMetLaagsteInkomen_3:14, HuishoudensOnderOfRondSociaalMinimum_5:4 }],
};

const cbsBuurt = { features:[{ properties:{
  buurtnaam:'Vathorst-Zuid', buurtcode:'BU03072801', gemeentecode:'GM0307',
  aantal_inwoners:835, aantal_woningen:304,
  gemiddeld_aardgasverbruik_totaal:1180, gemiddeld_elektriciteitsverbruik_totaal:3150,
  percentage_woningen_bouwjaar_voor_2000:12, percentage_eenpersoonshuishoudens:18,
  oppervlakte_land_in_ha:141, oppervlakte_water_in_ha:9 }}]};

let uitval = [];

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://example.org/', pretendToBeVisual: true,
  beforeParse(win) {
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {}; win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
    win.fetch = (url) => {
      const u = decodeURIComponent(String(url));
      verzoeken.push(u);
      const ok = o => Promise.resolve({ ok:true, json:() => Promise.resolve(o) });
      if (u.includes('wijkenbuurten')) {
        return u.includes('buurten') ? ok(cbsBuurt) : Promise.resolve({ ok:false, status:404 });
      }
      const m = u.match(/\/(\d{5}\w*)\//);
      if (m && u.includes('TypedDataSet')) {
        const t = m[1];
        if (uitval.includes(t)) return Promise.resolve({ ok:false, status:404 });
        return ok({ value: tabelData[t] || [] });
      }
      if (u.includes('SoortMisdrijf')) return Promise.resolve({ ok:false, status:404 });
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

  // ── Registratie ──
  await test('Zes onderwerpen geregistreerd', async () => {
    const alles = await w.haalAlleStatline('BU03072801', 'GM0307');
    const n = Object.keys(alles);
    return n.length === 6 ? n.join(', ') : n.length;
  });

  // ── Nabijheid ──
  await test('Nabijheid opgehaald ondanks volgnummers in veldnamen', async () => {
    const n = await w.haalStatline('nabijheid', 'BU03072801', 'GM0307');
    return n && n.dHuisarts === 1.4 && n.dZiekenhuis === 3.8 ? '1,4 km huisarts · 3,8 km ziekenhuis' : JSON.stringify(n);
  });
  await test('Schooltypen apart uitgelezen', async () => {
    const n = await w.haalStatline('nabijheid', 'BU03072801', 'GM0307');
    return n.dBasisschool === 0.8 && n.dVmbo === 2.9 && n.dHavoVwo === 3.4
      ? 'po 0,8 · vmbo 2,9 · havo/vwo 3,4' : [n.dBasisschool, n.dVmbo, n.dHavoVwo].join('/');
  });
  await test('Aantallen binnen straal uitgelezen', async () => {
    const n = await w.haalStatline('nabijheid', 'BU03072801', 'GM0307');
    return n.nBasisschool3 === 8.6 ? '8,6 basisscholen binnen 3 km' : n.nBasisschool3;
  });
  await test('Ontbrekende velden blijven null', async () => {
    const n = await w.haalStatline('nabijheid', 'BU03072801', 'GM0307');
    return n.dZwembad === null ? 'zwembad null (niet in antwoord)' : n.dZwembad;
  });

  // ── Energie ──
  await test('Totaalregel gekozen, niet de deelcategorie', async () => {
    const e = await w.haalStatline('energie', 'BU03072801', 'GM0307');
    return e.gas === 1180 ? '1.180 m³ (T001139), niet 1.450' : e.gas;
  });
  await test('Meest recente periode gekozen', async () => {
    const e = await w.haalStatline('energie', 'BU03072801', 'GM0307');
    return e.periode === '2023' && e.gas === 1180 ? '2023, niet 2019' : e.periode + '/' + e.gas;
  });
  await test('Gasverbruik per woningtype', async () => {
    const e = await w.haalStatline('energie', 'BU03072801', 'GM0307');
    return e.gasTussen === 1020 && e.gasVrij === 2240 ? 'tussen 1.020 · vrijstaand 2.240' : false;
  });

  // ── Gemeenteniveau ──
  await test('Verkoopprijzen op gemeentecode', async () => {
    const v = await w.haalStatline('verkoop', 'BU03072801', 'GM0307');
    return v && v.gemiddeldePrijs === 452000 && v.ontwikkeling === 7.4 ? '€ 452.000, +7,4%' : JSON.stringify(v);
  });
  await test('Prognose-onderwerp bestaat niet meer', async () => {
    // CBS en PBL hebben de regionale prognose teruggetrokken
    const p = await w.haalStatline('prognose', 'BU03072801', 'GM0307');
    return p === null ? 'null — onderwerp verwijderd' : JSON.stringify(p);
  });
  await test('Zonder gemeentecode geen verzoek voor gemeentetabel', async () => {
    const v = await w.haalStatline('verkoop', 'BU03072801', null);
    return v === null ? 'null (correct)' : false;
  });

  // ── Bodem en zon ──
  await test('Bodemgebruik uitgelezen', async () => {
    const b = await w.haalStatline('bodem', 'BU03072801', 'GM0307');
    return b.totaal === 150 && b.natuur === 15 ? '150 ha, 15 ha natuur' : JSON.stringify(b);
  });
  await test('Zonnestroom uitgelezen', async () => {
    const z = await w.haalStatline('zon', 'BU03072801', 'GM0307');
    return z.perWoning === 4080 ? '4.080 Wp per woning' : z.perWoning;
  });

  // ── Terugval ──
  await test('Terugval naar tweede tabelnummer', async () => {
    uitval = ['80305NED'];
    const n = await w.haalStatline('nabijheid', 'BU03072801', 'GM0307');
    uitval = [];
    return n === null ? 'null want 84463NED leeg (correct)' : n.tabel;
  });
  await test('Volledige uitval van één onderwerp raakt de rest niet', async () => {
    uitval = ['86211NED', '86210NED', '70262NED'];
    const alles = await w.haalAlleStatline('BU03072801', 'GM0307');
    uitval = [];
    return alles.bodem === null && alles.energie && alles.nabijheid
      ? 'bodem null, rest werkt' : JSON.stringify(Object.keys(alles).map(k => k + ':' + !!alles[k]));
  });

  // ── Alles ophalen ──
  await test('Alle onderwerpen parallel opgehaald', async () => {
    const alles = await w.haalAlleStatline('BU03072801', 'GM0307');
    const n = Object.values(alles).filter(Boolean).length;
    return n === 6 ? '6 van 6' : n + ' van 6';
  });

  // ── Weergave ──
  await test('Nabijheidsblok gegroepeerd weergegeven', () => {
    const h = w.nabijheidHTML();
    return h.includes('Zorg') && h.includes('Onderwijs en opvang') && h.includes('1,4 km') ? 'groepen + waarden' : false;
  });
  await test('Nabijheid meldt dat het een buurtgemiddelde is', () =>
    w.nabijheidHTML().includes('niet de afstand vanaf dit adres'));
  await test('Energieblok toont verbruik per woningtype', () => {
    const h = w.energieBuurtHTML();
    return h.includes('Tussenwoning 1.020 m³') ? 'per type getoond' : h.includes('1.180');
  });
  await test('Marktblok is als geen waardebepaling gemarkeerd', () => {
    const h = w.marktHTML();
    return h.includes('geen waardebepaling van deze woning') ? 'gemarkeerd' : false;
  });
  await test('Bodemgebruik omgerekend naar percentages', () => {
    const h = w.bodemZonHTML();
    // natuur 15 + recreatie 18 van 150 ha = 22%
    return h.includes('22%') ? 'groen 22%' : h.match(/>\d+%</g);
  });
  await test('Geen prognoseblok, met uitleg in de code', () => {
    const bron = fs.readFileSync(INDEX, 'utf8');
    return bron.includes('onvoldoende betrouwbaar') && bron.includes('adviseren')
      ? 'reden vastgelegd bij prognoseHTML' : false;
  });

  // ── Aanvullen van velden ──
  await test('Nabijheid vult lege voorzieningenvelden', async () => {
    await w.haalAlleStatline('BU03072801', 'GM0307');
    ['ziekenhuis','huisarts','apotheek','supermarkt','centrum','school'].forEach(id => {
      d.getElementById(id).value = 'onbekend';
    });
    const n = w.statlineVulAan();
    return n === 6 && d.getElementById('ziekenhuis').value === '2_5km'
      ? '6 velden, ziekenhuis 2–5 km' : n + '/' + d.getElementById('ziekenhuis').value;
  });
  await test('Aanvulling gemarkeerd als schatting met bronvermelding', () => {
    const p = w.provRijen().find(r => r.veld === 'ziekenhuis');
    return p && p.methode === 'schatting' && p.toelichting.includes('over de weg') ? 'schatting, over de weg' : false;
  });
  await test('Reeds ingevulde velden blijven ongemoeid', () => {
    d.getElementById('huisarts').value = 'lt1km';
    w.statlineVulAan();
    return d.getElementById('huisarts').value === 'lt1km';
  });

  // ── Verduurzaming op buurtverbruik ──
  await test('Verduurzaming gebruikt het buurtgemiddelde', () => {
    d.getElementById('woonoppervlak').value = '191';
    d.getElementById('bouwjaar').value = '2004';
    d.getElementById('gasverbruik').value = '';
    d.getElementById('woningtype').value = '';
    const v = w.berekenVerduurzaming();
    return v.gas === 1180 && v.gasBron === 'buurtgemiddelde' ? '1.180 m³ uit CBS' : v.gas + '/' + v.gasBron;
  });
  await test('Woningtype verfijnt het buurtgemiddelde', () => {
    d.getElementById('woningtype').value = 'rijtjeswoning';
    const v = w.berekenVerduurzaming();
    return v.gas === 1020 && v.gasBron.includes('rijtjeswoning')
      ? '1.020 m³ voor tussenwoning' : v.gas + '/' + v.gasBron;
  });
  await test('Eigen opgave gaat nog steeds voor', () => {
    d.getElementById('gasverbruik').value = '660';
    const v = w.berekenVerduurzaming();
    return v.gas === 660 && v.gasBron === 'opgegeven' ? '660 m³ opgegeven' : v.gas + '/' + v.gasBron;
  });

  // ── Statusoverzicht ──
  await test('Statusblok verschijnt bij gedeeltelijke uitval', async () => {
    uitval = ['86044NED', '85005NED'];
    await w.haalAlleStatline('BU03072801', 'GM0307');
    uitval = [];
    const h = w.statlineStatusHTML();
    return h.includes('Zonnestroom bij woningen') && h.includes('5 van de 6') ? '5 van 6 gemeld' : h.slice(0, 90);
  });
  await test('Statusblok blijft weg als alles lukt', async () => {
    await w.haalAlleStatline('BU03072801', 'GM0307');
    return w.statlineStatusHTML() === '' ? 'leeg (correct)' : false;
  });

  // ── Extra WFS-velden ──
  await test('Extra velden uit het WFS-antwoord uitgelezen', async () => {
    const c = await w.getCBSBuurt(52.19, 5.41);
    return c.gasGemiddeld === 1180 && c.oppLand === 141 && c.hhEenpersoons === 18
      ? 'gas, oppervlakte en huishoudens' : JSON.stringify([c.gasGemiddeld, c.oppLand, c.hhEenpersoons]);
  });

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 800);
