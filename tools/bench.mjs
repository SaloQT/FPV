#!/usr/bin/env node
/**
 * Benchmark runner: starts Vite (unless --url is given), opens the app with ?bench=1 in headless Chromium, waits for
 * window.__fpv.bench and prints it as JSON (avgFps, p1LowFps, avgGpuMs, perPassMs, renderScale, device, ...).
 *
 *   node tools/bench.mjs                          software WebGPU (SwiftShader): proves the pipeline runs, says nothing about speed
 *   node tools/bench.mjs --gpu                    requests the browser's default GPU adapter; verify returned identity (set CHROME_BIN)
 *   node tools/bench.mjs --gpu --uncapped         uses the runner's existing frame-limit/v-sync overrides; observed frame rate still
 *                                                 includes CPU/browser overhead and does not by itself prove GPU throughput
 *
 * CHROME_BIN is the path of the browser executable. Without it the software run falls back to the Chromium of the development container
 * (/opt/pw-browsers/chromium-1194), which exists nowhere else, and --gpu has no browser at all unless Playwright installed one.
 *
 * Options: --seconds <n> measured seconds (default 20)   --warmup <n> seconds (default 2)   --size 1920x1080
 *          --query "quality=ultra&scale=0.75&perf240=1"  extra app query parameters (see src/app/perfParams.ts, src/app/params.ts)
 *          --profile  opt-in detailed timestamp diagnostics (adds RT pass segmentation overhead)
 *          --out <file.json>  also write the result   --url <base>  use a running server   --wait <ms>  overall timeout (default 900000)
 *
 * Exit code 1 if the page logs an error or the benchmark does not finish.
 */
import { chromium } from 'playwright-core';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']] : a), []));
const [width, height] = (args.size ?? '1920x1080').split('x').map(Number);
const waitMs = Number(args.wait ?? 900000);
const exe = process.env.CHROME_BIN ?? (args.gpu ? undefined : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

const gpuArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist', '--no-sandbox', '--enable-webgpu-developer-features'];
const softwareArgs = [...gpuArgs, '--use-angle=swiftshader', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-gpu-watchdog', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
const launchArgs = [...(args.gpu ? gpuArgs : softwareArgs), ...(args.uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])];

// Snapshot before Vite/browser startup. A checkout HEAD does not identify dirty served files.
function checkoutSnapshot() {
  try {
    const git = (argv) => execFileSync('git', argv, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    const hash = value => createHash('sha256').update(value).digest('hex');
    const status = git(['status', '--porcelain', '--untracked-files=normal']);
    return { checkoutHead: git(['rev-parse', 'HEAD']).trim(), worktreeDirty: status.length > 0,
      trackedDiffSha256: hash(git(['diff', '--binary', 'HEAD', '--'])), statusSha256: hash(status) };
  } catch { return null; }
}
const sourceStart = args.url ? null : checkoutSnapshot();

let server;
const stopServer = () => { if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); } server = undefined; } };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopServer(); process.exit(130); });
let base = args.url;
if (!base) {
  const port = Number(args.port ?? (await freePort()));
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  base = `http://127.0.0.1:${port}/`;
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite did not start')), 30000);
    server.stdout.on('data', (d) => { if (String(d).includes('Local') || String(d).includes('ready')) { clearTimeout(t); res(); } });
    server.on('exit', (c) => { clearTimeout(t); rej(new Error('vite exited ' + c)); });
  }).catch((e) => {
    stopServer();
    console.error(`bench: ${e.message}`);
    process.exit(2);
  });
}

const query = new URLSearchParams(args.query ?? '');
query.set('bench', '1');
if (args.profile) query.set('gpuProfile', '1');
query.set('benchSeconds', String(args.seconds ?? 20));
query.set('benchWarmup', String(args.warmup ?? 2));
if (args.uncapped && !query.has('refresh')) query.set('refresh', '1000');

let browser;
try {
  browser = await chromium.launch({ executablePath: exe, headless: !args.headed, args: launchArgs });
} catch (e) {
  stopServer();
  console.error(`bench: could not start a browser (${exe ?? 'playwright default'}): ${e.message.split('\n')[0]}\nSet CHROME_BIN to a Chrome or Chromium executable${args.gpu ? ' with a working GPU and WebGPU' : ''}.`);
  process.exit(2);
}
const errors = [];
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[error] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.stack ?? e.message}`));
  await page.goto(`${base}?${query}`, { waitUntil: 'load' });
  const done = await page.waitForFunction(() => window.__fpv && (window.__fpv.bench || window.__fpv.error), null, { timeout: waitMs, polling: 1000 }).then(() => true).catch(() => false);
  if (!done) errors.push(`[harness] the benchmark did not finish within ${waitMs} ms`);
  const bench = await page.evaluate(() => window.__fpv?.bench ?? null);
  const appError = await page.evaluate(() => window.__fpv?.error ?? null);
  if (appError) errors.push(`[app] ${appError}`);
  if (bench) {
    const sourceEnd = args.url ? null : checkoutSnapshot();
    const fingerprintsChanged = sourceStart && sourceEnd ? JSON.stringify(sourceStart) !== JSON.stringify(sourceEnd) : null;
    const cleanUnchanged = sourceStart && sourceEnd && !sourceStart.worktreeDirty && !sourceEnd.worktreeDirty && !fingerprintsChanged;
    // Untracked file contents are not fingerprinted; any dirty run has an unverified exact source revision.
    const revision = cleanUnchanged ? sourceStart.checkoutHead : null;
    bench.provenance = { ...bench.provenance, harness: {
      requestedAdapterMode: args.gpu ? 'gpu-requested-unverified' : 'software-requested',
      browserVersion: browser.version(), headless: !args.headed, uncapped: Boolean(args.uncapped), launchArgs,
      viewport: { width, height }, url: `${base}?${query}`, revision, sourceStart, sourceEnd,
      sourceChangedDuringRun: fingerprintsChanged === true ? true : cleanUnchanged ? false : null,
      sourceNote: args.url ? 'External server build identity is unknown.' : revision ? 'Clean unchanged checkout served by local Vite.' : 'Exact served source revision is unverified (dirty, changed, or unavailable checkout).',
      fingerprintScope: 'Checkout HEAD, tracked diff and git status; excludes untracked file contents.',
    } };
  }
  if (bench && args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(bench, null, 2));
  }
  console.log(JSON.stringify({ url: `${base}?${query}`, bench, errors: errors.slice(0, 20) }, null, 2));
  if (!bench || errors.length || bench.incompleteReason) code = 1;
} catch (e) {
  console.error('harness failure:', e);
  code = 1;
} finally {
  await browser.close().catch(() => undefined);
  stopServer();
}
process.exit(code);
