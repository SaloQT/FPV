#!/usr/bin/env node
/** Print the generated parts behind audit finding groups: shape, size, ride-local position, source and
 * declared joints. Usage: node tools/park-audit-explain.mjs --report <dir> --match "<regex on group key>" [--examples 3] */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).reduce((all, key, i, raw) => key.startsWith('--') ? [...all, [key.slice(2), raw[i + 1]?.startsWith('--') === false ? raw[i + 1] : '1']] : all, []));
const dir = resolve(args.report ?? '.bench/park-audit'), report = JSON.parse(await readFile(resolve(dir, 'report.json'), 'utf8'));
const api = await import(pathToFileURL(resolve(dir, 'bundle/audit.mjs')).href); api.setPartProvenance(true);
const match = new RegExp(args.match ?? '.', 'i'), examples = Number(args.examples ?? 3);
for (const entry of report.parks) {
  const { park } = api.buildPark({ ...api.defaultParkRecipe(entry.seed, entry.size), guests: 0 });
  const joints = new Map(); for (const j of park.joints ?? []) for (const a of [j.a, j.b]) (joints.get(a.part) ?? joints.set(a.part, []).get(a.part)).push(`${j.kind}:${j.name}`);
  const findings = [...entry.samples.flatMap(s => s.findings), ...(entry.motion?.findings ?? [])];
  for (const g of entry.groups.filter(g => match.test(g.key))) {
    console.log(`\n== ${g.key}  (${g.count}, worst ${(g.maxMeasured * 1000).toFixed(1)} mm)`);
    const list = findings.filter(f => `${f.kind} | ${f.family} | ${f.sources.map(s => s.split(' < ')[0]).join(' x ')}` === g.key).sort((a, b) => b.measured - a.measured);
    const picks = [list[0], list[Math.floor(list.length / 2)], list[list.length - 1]].slice(0, examples).filter(Boolean);
    for (const f of picks) {
      const ride = f.ride >= 0 ? park.rides[f.ride] : null;
      console.log(`  - ${f.detail} measured ${(f.measured * 1000).toFixed(1)} mm t=${f.time}`);
      for (const id of f.parts) {
        const p = park.parts[id], c = Math.cos(ride?.yaw ?? 0), s = Math.sin(ride?.yaw ?? 0);
        const d = ride && p.body < 0 ? [p.pos[0] - ride.pos[0], p.pos[1] - ride.pos[1], p.pos[2] - ride.pos[2]] : p.pos;
        const local = ride && p.body < 0 ? [c * d[0] - s * d[2], d[1], s * d[0] + c * d[2]] : d;
        console.log(`      #${id} ${p.shape} half=[${p.half.map(v => v.toFixed(3))}] ${p.body >= 0 ? `body ${p.body} (${park.bodies[p.body].role})` : 'static'} ${ride && p.body < 0 ? 'ride-local' : 'pos'}=[${local.map(v => v.toFixed(3))}] color=[${p.color.map(v => v.toFixed(2))}] ${p.solid ? '' : 'non-solid'} src=${api.partSource(p)}`);
        for (const j of (joints.get(id) ?? []).slice(0, 3)) console.log(`          joint ${j}`);
      }
    }
  }
}
