#!/usr/bin/env node
/**
 * HEAD against the working tree in the real browser: runs tools/audit/browser-check.mjs once per arm, case and round, interleaved, so
 * background GPU load hits both arms alike. The HEAD arm serves a worktree of HEAD, made once with
 *   git worktree add --detach .bench/perf-head HEAD
 * (move it to a new HEAD with `git -C .bench/perf-head checkout --detach <rev>`).
 *
 *   node tools/audit/perf-ab.mjs [--rounds 2] [--worlds park,track] [--qualities ultra,high] [--hours 12] [--head .bench/perf-head]
 *   python tools/audit/perf-summary.py
 *
 * Writes .bench/audit/perf/<arm>/r<round>-<world>-<quality>.json and a log beside each.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((o, v, i, all) => v.startsWith('--') ? [...o, [v.slice(2), all[i + 1]]] : o, []));
const rounds = Number(args.rounds ?? 2), worlds = (args.worlds ?? 'park,track').split(','), qualities = (args.qualities ?? 'ultra,high').split(',');
const hours = args.hours ?? '12', head = args.head ?? '.bench/perf-head';
const out = resolve(ROOT, '.bench/audit/perf');
mkdirSync(out, { recursive: true });

function run(arm, round, world, quality) {
  const log = createWriteStream(resolve(out, `${arm}-r${round}-${world}-${quality}.log`));
  const child = spawn(process.execPath, [resolve(ROOT, 'tools/audit/browser-check.mjs'), '--root', arm === 'head' ? head : '.', '--cases', world,
    '--qualities', quality, '--hours', hours, '--out', `.bench/audit/perf/${arm}`, '--results', `r${round}-${world}-${quality}.json`], { cwd: ROOT });
  child.stdout.pipe(log); child.stderr.pipe(log);
  return new Promise((done) => child.on('close', (code) => { log.end(); done(code); }));
}

for (let round = 1; round <= rounds; round++) for (const world of worlds) for (const quality of qualities) for (const arm of ['head', 'work']) {
  const code = await run(arm, round, world, quality);
  console.log(`done ${arm} r${round} ${world} ${quality} ${code}`);
}
