#!/usr/bin/env node
/**
 * Benchmark runner: starts Vite (unless --url is given), opens the app with ?bench=1 in headless Chromium, waits for
 * window.__fpv.bench and prints it as JSON (avgFps, p1LowFps, avgGpuMs, perPassMs, renderScale, device, ...).
 *
 *   node tools/bench.mjs                          software WebGPU (SwiftShader): proves the pipeline runs, says nothing about speed
 *   node tools/bench.mjs --gpu                    the machine's real GPU (needs a Chromium/Chrome with WebGPU; set CHROME_BIN)
 *   node tools/bench.mjs --gpu --uncapped         also lifts Chrome's frame-rate limit and v-sync so avgFps shows what the GPU can do
 *                                                 beyond the display refresh (a measuring aid; a normal page can never do this)
 *
 * CHROME_BIN is the path of the browser executable. Without it the software run falls back to the Chromium of the development container
 * (/opt/pw-browsers/chromium-1194), which exists nowhere else, and --gpu has no browser at all unless Playwright installed one.
 *
 * Options: --seconds <n> measured seconds (default 20)   --warmup <n> seconds (default 2)   --size 1920x1080
 *          --query "quality=ultra&scale=0.75&perf240=1"  extra app query parameters (see src/app/perfParams.ts, src/app/params.ts)
 *          --out <file.json>  also write the result   --url <base>  use a running server   --wait <ms>  overall timeout (default 900000)
 *
 * Exit code 1 if the page logs an error or the benchmark does not finish.
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']] : a), []));
const [width, height] = (args.size ?? '1920x1080').split('x').map(Number);
const waitMs = Number(args.wait ?? 900000);
const exe = process.env.CHROME_BIN ?? (args.gpu ? undefined : '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

const gpuArgs = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--ignore-gpu-blocklist', '--no-sandbox', '--enable-webgpu-developer-features'];
const softwareArgs = [...gpuArgs, '--use-angle=swiftshader', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--disable-gpu-watchdog', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
const launchArgs = [...(args.gpu ? gpuArgs : softwareArgs), ...(args.uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])];

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
  if (bench && args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, JSON.stringify(bench, null, 2));
  }
  console.log(JSON.stringify({ url: `${base}?${query}`, bench, errors: errors.slice(0, 20) }, null, 2));
  if (!bench || errors.length) code = 1;
} catch (e) {
  console.error('harness failure:', e);
  code = 1;
} finally {
  await browser.close().catch(() => undefined);
  stopServer();
}
process.exit(code);
