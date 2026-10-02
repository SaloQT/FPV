#!/usr/bin/env node
/**
 * Headless verification harness: starts Vite (unless --url is given), opens the app in Chromium with software
 * WebGPU (SwiftShader), waits for window.__fpv.ready, prints console errors and a JSON stats report, saves a PNG.
 *
 *   node tools/shot.mjs --query "seed=7&t=12" --out shots/noon.png --size 960x540 --wait 300000
 *   node tools/shot.mjs --eval "window.__fpv.stats" --keys "w:1500,d:500"   (hold keys for ms while running)
 *
 * Options: --query <params> app query string   --out <png>   --size WxH   --wait <ms> time to reach __fpv.ready (default 60000; software WebGPU
 *          needs minutes at 960x540, so pass 300000)   --settle <ms> pause before the screenshot (default 1500)   --url <base> use a running server
 *          --port <n> Vite port   --verbose also print console logs   Environment: CHROME_BIN is the browser executable (default: the container's Chromium).
 *
 * Exit code 1 if the page throws, logs console.error, or never becomes ready. SwiftShader is ~1000x slower than a
 * real GPU: judge correctness and image content here, never performance.
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import net from 'node:net';
import { dirname } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']] : a), []));
const size = (args.size ?? '960x540').split('x').map(Number);
const out = args.out ?? 'shots/shot.png';
const waitMs = Number(args.wait ?? 60000);
const settleMs = Number(args.settle ?? 1500);
const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const port = Number(args.port ?? (await freePort()));
const exe = process.env.CHROME_BIN ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let server;
const stopServer = () => { if (server) { try { process.kill(-server.pid, 'SIGTERM'); } catch { server.kill('SIGTERM'); } server = undefined; } };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopServer(); process.exit(130); });
let base = args.url;
let browser;
try {
  if (!base) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    base = `http://127.0.0.1:${port}/`;
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('vite did not start')), 30000);
      server.stdout.on('data', (d) => { if (String(d).includes('Local') || String(d).includes('ready')) { clearTimeout(t); res(); } });
      server.on('exit', (c) => { clearTimeout(t); rej(new Error('vite exited ' + c)); });
    });
  }
  browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=swiftshader', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--enable-webgpu-developer-features', '--disable-gpu-watchdog', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
} catch (e) {
  stopServer();
  console.error(`shot: could not start (${e.message.split('\n')[0]}). Set CHROME_BIN to a Chrome or Chromium executable with WebGPU.`);
  process.exit(2);
}
const errors = [];
const logs = [];
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
  page.on('console', (m) => { const t = m.type(); const s = `[${t}] ${m.text()}`; if (t === 'error') errors.push(s); else if (args.verbose || t === 'warning') logs.push(s); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.stack ?? e.message}`));
  const url = base + (args.query ? (base.includes('?') ? '&' : '?') + args.query : '');
  await page.goto(url, { waitUntil: 'load' });
  const ready = await page.waitForFunction(() => window.__fpv && (window.__fpv.ready || window.__fpv.error), null, { timeout: waitMs }).then(() => true).catch(() => false);
  if (!ready) { errors.push(`[harness] window.__fpv.ready not set within ${waitMs}ms`); }
  const fpvErr = await page.evaluate(() => window.__fpv?.error ?? null);
  if (fpvErr) errors.push(`[app] ${fpvErr}`);
  if (args.keys) {
    for (const part of String(args.keys).split(',')) {
      const [k, ms] = part.split(':');
      await page.keyboard.down(k); await page.waitForTimeout(Number(ms)); await page.keyboard.up(k);
    }
  }
  await page.waitForTimeout(settleMs);
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out, timeout: 300000 });
  const stats = await page.evaluate(async (expr) => { try { return expr ? await eval(expr) : (window.__fpv?.stats ?? null); } catch (e) { return 'eval error: ' + e; } }, args.eval ?? null);
  console.log(JSON.stringify({ url, screenshot: out, stats, warnings: logs.slice(0, 40), errors: errors.slice(0, 40) }, null, 2));
  if (errors.length) code = 1;
} catch (e) {
  console.error('harness failure:', e);
  code = 1;
} finally {
  await browser.close().catch(() => undefined);
  stopServer();
}
process.exit(code);
