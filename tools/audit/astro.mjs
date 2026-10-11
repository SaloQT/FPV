#!/usr/bin/env node
/** Sun and moon elevation (degrees) and the moon's lit fraction at UTC hours of a date, for the default observer, from a measure.mjs bundle.
 *    node tools/audit/astro.mjs <bundle.mjs> [--date 2026-06-21] [--hours 21,22,23.5] */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const a = await import(pathToFileURL(resolve(argv[0])).href);
const [y, m, d] = opt('date', '2026-06-21').split('-').map(Number);
for (const h of opt('hours', '21,22,23.5').split(',').map(Number)) {
  const s = a.computeAstro(Date.UTC(y, m - 1, d, Math.floor(h), Math.round((h % 1) * 60)), a.DEFAULT_SETTINGS.observer);
  console.log(`${h} UTC  sun ${(s.sunElevation * 180 / Math.PI).toFixed(1)}  moon ${(s.moonElevation * 180 / Math.PI).toFixed(1)}  lit ${s.moonIlluminatedFraction.toFixed(2)}`);
}
