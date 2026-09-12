#!/usr/bin/env node
/**
 * run.js — draait alle testsuites en vat samen.
 *
 * Elke suite start de tool in jsdom met een nagebootste netwerklaag en
 * eindigt met exitcode 0 of 1. Deze runner meldt per suite het aantal
 * geslaagde en gefaalde toetsen en geeft zelf een exitcode terug, zodat
 * GitHub Actions de build kan laten falen.
 *
 *   node tests/run.js            alle suites
 *   node tests/run.js test12     alleen die suite
 *   node tests/run.js --stil     alleen de samenvatting
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const args = process.argv.slice(2);
const stil = args.includes('--stil');
const filter = args.filter(a => !a.startsWith('--'));

const suites = fs.readdirSync(dir)
  .filter(f => /^test\d+\.js$/.test(f))
  .filter(f => !filter.length || filter.some(x => f.startsWith(x)))
  .sort((a, b) => parseInt(a.match(/\d+/)[0]) - parseInt(b.match(/\d+/)[0]));

if (!suites.length) {
  console.error('Geen testsuites gevonden' + (filter.length ? ' voor ' + filter.join(', ') : ''));
  process.exit(1);
}

let totaalOk = 0, totaalFout = 0;
const mislukt = [];

for (const suite of suites) {
  let uit = '';
  let code = 0;
  try {
    uit = execFileSync(process.execPath, [path.join(dir, suite)], {
      encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    uit = (e.stdout || '') + (e.stderr || '');
    code = e.status === undefined ? 1 : e.status;
  }
  const ok = (uit.match(/^OK/gm) || []).length;
  const fout = (uit.match(/^FOUT/gm) || []).length;
  totaalOk += ok;
  totaalFout += fout;

  const naam = suite.replace('.js', '').padEnd(8);
  const status = (fout === 0 && code === 0) ? 'ok  ' : 'FOUT';
  console.log(`${status} ${naam} ${String(ok).padStart(3)} geslaagd` +
              (fout ? `, ${fout} gefaald` : ''));

  if (fout || code !== 0) {
    mislukt.push(suite);
    uit.split('\n').filter(l => l.startsWith('FOUT') || l.startsWith('  !'))
       .forEach(l => console.log('     ' + l));
  } else if (!stil) {
    uit.split('\n').filter(l => l.startsWith('OK')).forEach(l => console.log('     ' + l));
  }
}

console.log('\n' + '='.repeat(58));
console.log(`${suites.length} suites · ${totaalOk} geslaagd · ${totaalFout} gefaald`);
if (mislukt.length) {
  console.log('Gefaalde suites: ' + mislukt.join(', '));
  process.exit(1);
}
console.log('Alles groen.');
