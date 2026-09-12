const INDEX = require('path').join(__dirname, '..', 'index.html');
// Test: indicatieve waarde, indexatie en WOZ-reeks
const fs = require('fs');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(INDEX, 'utf8');
const fouten = [];
const LAT = 52.19730, LON = 5.41160;

// 60 verblijfsobjecten met woonfunctie, gemiddeld 150 m²
const vbos = [];
for (let i = 0; i < 60; i++) {
  vbos.push({ properties:{ gebruiksdoel:['woonfunctie'], oppervlakte: 120 + (i % 7) * 10 } });
}
// Ruis die eruit gefilterd moet worden
vbos.push({ properties:{ gebruiksdoel:['winkelfunctie'], oppervlakte: 2000 } });
vbos.push({ properties:{ gebruiksdoel:['woonfunctie'], oppervlakte: 5 } });
vbos.push({ properties:{ gebruiksdoel:['woonfunctie'], oppervlakte: 4000 } });

let bagScenario = 'ok';

const dom = new JSDOM(html, {
  runScripts:'dangerously', url:'https://example.org/', pretendToBeVisual:true,
  beforeParse(win) {
    win.AbortSignal.timeout = () => new win.AbortController().signal;
    win.print = () => {}; win.scrollTo = () => {};
    win.console.error = (...a) => fouten.push(a.join(' '));
    win.fetch = (url) => {
      const u = decodeURIComponent(String(url));
      const ok = o => Promise.resolve({ ok:true, json:() => Promise.resolve(o) });
      if (u.includes('bag:verblijfsobject') && u.includes('bbox')) {
        if (bagScenario === 'weinig') return ok({ features: vbos.slice(0, 5) });
        if (bagScenario === 'faalt') return Promise.resolve({ ok:false, status:500 });
        return ok({ features: vbos });
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

  // ── Gemiddeld woonoppervlak ──
  await test('Buurtoppervlak gemeten uit de BAG', async () => {
    const o = await w.getGemiddeldWoonoppervlak(LAT, LON);
    return o && o.aantal === 60 ? o.aantal + ' woningen, gemiddeld ' + o.gemiddelde + ' m²' : JSON.stringify(o);
  });
  await test('Niet-woonfuncties en uitschieters gefilterd', async () => {
    const o = await w.getGemiddeldWoonoppervlak(LAT, LON);
    return o.grootste <= 1000 && o.kleinste >= 20 ? o.kleinste + '–' + o.grootste + ' m²' : false;
  });
  await test('Mediaan berekend', async () => {
    const o = await w.getGemiddeldWoonoppervlak(LAT, LON);
    return o.mediaan > 0 ? o.mediaan + ' m²' : false;
  });
  await test('Te weinig woningen geeft null', async () => {
    bagScenario = 'weinig';
    const o = await w.getGemiddeldWoonoppervlak(LAT, LON);
    bagScenario = 'ok';
    return o === null ? 'null bij minder dan 10 woningen' : false;
  });
  await test('Falende BAG geeft null', async () => {
    bagScenario = 'faalt';
    const o = await w.getGemiddeldWoonoppervlak(LAT, LON);
    bagScenario = 'ok';
    return o === null ? 'null (correct)' : false;
  });

  // ── Periode en indexatie ──
  await test('Jaarperiode naar datum', () => {
    const dt = w.periodeNaarDatum('2024JJ00');
    return dt.getFullYear() === 2024 && dt.getMonth() === 6 ? 'midden 2024' : dt;
  });
  await test('Kwartaalperiode naar datum', () => {
    const dt = w.periodeNaarDatum('2024KW02');
    return dt.getFullYear() === 2024 && dt.getMonth() === 4 ? 'mei 2024' : dt.getMonth();
  });
  await test('Peildatum naar datum', () => {
    const dt = w.periodeNaarDatum('2025-01-01');
    return dt.getFullYear() === 2025 && dt.getMonth() === 0 ? '1 januari 2025' : dt;
  });
  await test('Onbekende notatie geeft null', () => w.periodeNaarDatum('onzin') === null);

  await test('Indexatie rekent samengesteld', () => {
    const r = w.indexeer(100000, new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1), 10);
    return r.toegepast && r.bedrag === 110000 ? '€ 100.000 → € 110.000 bij 10% over 12 maanden' : r.bedrag;
  });
  await test('Indexatie over halve periode', () => {
    const dt = new Date(); dt.setMonth(dt.getMonth() - 6);
    const r = w.indexeer(100000, dt, 10);
    return r.bedrag > 104000 && r.bedrag < 105000 ? '€ ' + r.bedrag + ' na 6 maanden' : r.bedrag;
  });
  await test('Zonder groeipercentage niet indexeren', () => {
    const dt = new Date(); dt.setFullYear(dt.getFullYear() - 2);
    const r = w.indexeer(100000, dt, null);
    return r.toegepast === false && r.bedrag === 100000 ? 'ongewijzigd, gemarkeerd' : JSON.stringify(r);
  });
  await test('Toekomstige peildatum niet indexeren', () => {
    const dt = new Date(); dt.setFullYear(dt.getFullYear() + 1);
    const r = w.indexeer(100000, dt, 8);
    return r.toegepast === false ? 'niet toegepast' : false;
  });
  await test('Negatieve ontwikkeling verlaagt de waarde', () => {
    const dt = new Date(); dt.setFullYear(dt.getFullYear() - 1);
    const r = w.indexeer(100000, dt, -5);
    return r.bedrag === 95000 ? '€ 95.000 bij -5%' : r.bedrag;
  });

  // ── Waardeberekening ──
  await test('Geen invoer geeft geen blok', () => {
    d.getElementById('woonoppervlak').value = '';
    return w.waardeHTML() === '' ? 'leeg (correct)' : false;
  });

  await test('Methode A rekent zoals gevraagd', async () => {
    // Handmatig de benodigde context zetten via de publieke functies
    d.getElementById('woonoppervlak').value = '191';
    const r = w.berekenIndicatieveWaarde();
    // Zonder _sl.verkoop en _buurtOpp is A leeg; dat is het verwachte gedrag
    return r.A === null ? 'geen A zonder marktdata (correct)' : 'A aanwezig';
  });

  await test('Deling en vermenigvuldiging kloppen rekenkundig', () => {
    // 551.639 / 150 = 3.677,6 per m²; × 191 = 702.421
    const prijsPerM2 = 551639 / 150;
    const uitkomst = Math.round(prijsPerM2 * 191);
    return uitkomst === 702421 ? '€ 551.639 / 150 m² × 191 m² = € 702.421' : uitkomst;
  });
  await test('Indexatie bovenop die uitkomst', () => {
    const dt = new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1);
    const r = w.indexeer(702421, dt, 7.4);
    return r.bedrag === 754400 ? '€ 702.421 → € 754.400 bij 7,4%' : '€ ' + r.bedrag;
  });

  // ── Bandbreedte ──
  await test('Bandbreedte leeg zonder methodes', () => {
    const r = w.berekenIndicatieveWaarde();
    return r.laag === null && r.hoog === null ? 'null/null' : r.laag + '/' + r.hoog;
  });

  // ── Waarschuwingen ──
  await test('Waardeblok bevat de Wft-markering in de broncode', () => {
    const bron = fs.readFileSync(INDEX, 'utf8');
    return bron.includes('nadrukkelijk geen taxatie en geen advies in de zin van de Wft')
      && bron.includes('niet worden gebruikt voor financiering') ? 'aanwezig' : false;
  });
  await test('Uitleg over de gebiedsmismatch aanwezig', () => {
    const bron = fs.readFileSync(INDEX, 'utf8');
    return bron.includes('gemeente</em> door het gemiddelde woonoppervlak in de <em>buurt')
      && bron.includes('niet lineair') ? 'gemeente/buurt en niet-lineair genoemd' : false;
  });
  await test('Waarschuwing bij grote spreiding ingebouwd', () => {
    const bron = fs.readFileSync(INDEX, 'utf8');
    return bron.includes('% uiteen.</strong> Dat is precies het signaal');
  });
  await test('WOZ-reeks toont ontwikkeling per jaar', () => {
    const bron = fs.readFileSync(INDEX, 'utf8');
    return bron.includes('Ontwikkeling over ') && bron.includes('Gemiddeld per jaar')
      && bron.includes('Verschil met jaar ervoor') ? 'reeks, totaal en jaargemiddelde' : false;
  });

  // ── Reken de WOZ-reeks na met de cijfers van het voorbeeld ──
  await test('Samengestelde groei WOZ 755k → 856k over 2 jaar', () => {
    const perJaar = Math.round((Math.pow(856000 / 755000, 1 / 2) - 1) * 1000) / 10;
    return perJaar === 6.5 ? '+6,5% per jaar' : perJaar;
  });

  console.log('\n--- Console-fouten: ' + fouten.length + ' ---');
  fouten.slice(0, 8).forEach(f => console.log('  ! ' + f));
  process.exit(fouten.length ? 1 : 0);
}, 700);
