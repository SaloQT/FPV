// Replays a finished (or killed) training run in the dashboard, from the files the live dashboard wrote. No GPU, no trainer.
//
//   node tools/brain/dashboard.mjs --run .bench/brain/runs/ace          # reads ace.train.ndjson and ace.trace.bin
//   node tools/brain/dashboard.mjs --run .bench/brain/runs/ace --port 8790 --host 0.0.0.0
//
// --run takes the run's path without the extension (a path to either file works too). --port [8787], --host [127.0.0.1].
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTraceFile, serveDashboard } from './dashServer.mjs';

/** Parses a run's ndjson text: { meta, worldsJson, history: { iters, lines }, ended }. Unreadable lines are skipped. */
export function parseRunLog(text) {
  let meta = null;
  let worldsJson = '[]';
  let ended = false;
  const commands = [];
  const byIter = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('{"kind":"worlds"')) {
      // The worlds line is large: cut the array out rather than parse and re-encode it.
      const at = line.indexOf('"worlds":', 9) + 9;
      worldsJson = line.slice(at, line.lastIndexOf('}'));
      continue;
    }
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.kind === 'meta') meta = rec;
    else if (rec.kind === 'iter' && Number.isFinite(rec.iteration)) byIter.set(rec.iteration, line);
    else if (rec.kind === 'event') commands.push(rec);
    else if (rec.kind === 'end') ended = true;
  }
  const iters = [...byIter.keys()].sort((a, b) => a - b);
  return { meta, worldsJson, history: { iters, lines: iters.map((i) => byIter.get(i)) }, ended, commands };
}

/** Serves the run at `runPath` (no extension). Returns the server handle. */
export async function replayRun(runPath, { port = 8787, host = '127.0.0.1', log = console.log } = {}) {
  const base = runPath.replace(/\.(train\.ndjson|trace\.bin)$/, '');
  const ndjson = `${base}.train.ndjson`;
  if (!existsSync(ndjson)) throw new Error(`no run log at ${ndjson}`);
  const run = parseRunLog(await readFile(ndjson, 'utf8'));
  if (!run.meta) throw new Error(`${ndjson} has no meta line`);
  let file = null;
  if (existsSync(`${base}.trace.bin`)) {
    try { file = await openTraceFile(`${base}.trace.bin`); } catch (e) { log?.(`traces skipped: ${e.message}`); }
  }
  const entries = file?.entries ?? new Map();
  const sorted = [...entries.keys()].sort((a, b) => a - b);
  const traces = {
    size: entries.size,
    has: (it) => entries.has(it),
    list: () => sorted,
    async get(it) {
      const e = entries.get(it);
      if (!e) return null;
      const bytes = await file.read(e.offset + 16, e.K * e.T * 16);
      return bytes ? { K: e.K, T: e.T, bytes } : null;
    },
  };
  const first = entries.values().next().value;
  const meta = {
    ...run.meta, mode: 'replay', status: run.ended ? 'finished' : 'interrupted',
    traceEnvs: run.meta.traceEnvs || first?.K || 0, traceSteps: run.meta.traceSteps || first?.T || 0,
  };
  const http = await serveDashboard({ meta, worldsJson: run.worldsJson, history: run.history, traces }, { port, host, log });
  log?.(`${run.history.iters.length} iterations, ${entries.size} traces${file && !file.indexed ? ' (no index: the run did not close cleanly)' : ''}`);
  return { ...http, async close() { await http.close(); await file?.close(); } };
}

const self = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (self) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? 'true' : (all[i + 1] ?? 'true')]] : acc), []));
  if (!args.run || args.run === 'true') {
    console.error('usage: node tools/brain/dashboard.mjs --run <outDir>/<name> [--port 8787] [--host 127.0.0.1]');
    process.exit(2);
  }
  await replayRun(resolve(args.run), { port: Number(args.port ?? 8787), host: args.host ?? '127.0.0.1' });
}
