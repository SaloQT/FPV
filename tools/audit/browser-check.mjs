#!/usr/bin/env node
/**
 * The real game in headless Chromium (newest Playwright build, hardware WebGPU) through the Vite dev server, hmr and watch off: for each case
 * (world x quality x hour) it loads the page, records every console error/warning and page error, the time to window.__fpv.ready (first
 * frame), the frame times over 10 s of the live loop, the renderer's GPU ms, and a screenshot. One persistent profile per run, so the first
 * extreme load is a cold IndexedDB tree build and the later ones are warm. The machine-wide GPU lock is held per case only.
 *
 *   node tools/audit/browser-check.mjs [--out .bench/audit/browser] [--root <app copy>] [--cases park,track] [--qualities ultra,extreme] [--hours 12,23.5]
 *     [--results results.json]
 *
 * park is theme park seed 1337; track is the hard-210-t2 track (tools/views/hard-210-t2.json). Needs a Playwright Chromium under
 * %LOCALAPPDATA%/ms-playwright (npx playwright-core install chromium) or CHROME_BIN. Each result line carries console errors, readyS,
 * frameMs, gpuMs and passMs; a pass is no `fail`, no `error` and an empty `console`.
 */
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const ROOT = resolve(import.meta.dirname, '../..');
const args = Object.fromEntries(process.argv.slice(2).reduce((o, v, i, all) => v.startsWith('--') ? [...o, [v.slice(2), all[i + 1]]] : o, []));
const out = resolve(ROOT, args.out ?? '.bench/audit/browser');
const worlds = (args.cases ?? 'park,track').split(','), qualities = (args.qualities ?? 'ultra,extreme').split(','), hours = (args.hours ?? '12,23.5').split(',');
await mkdir(out, { recursive: true });

const pw = join(homedir(), 'AppData/Local/ms-playwright');
const exe = process.env.CHROME_BIN ?? readdirSync(pw).filter(d => /^chromium-\d+$/.test(d)).sort((p, q) => Number(q.slice(9)) - Number(p.slice(9))).map(d => join(pw, d, 'chrome-win64/chrome.exe')).find(existsSync);
const track = JSON.parse(await readFile(resolve(ROOT, 'tools/views/hard-210-t2.json'), 'utf8'));
const { acquireGpuLock } = await import(pathToFileURL(resolve(ROOT, 'tools/native-bench/lock.mjs')).href);

// --root <dir>: serve another copy of the app (index.html, src/, vite.config.ts) for an A/B; public/ always comes from the checkout.
const appRoot = resolve(ROOT, args.root ?? '.');
const server = await createServer({ configFile: resolve(appRoot, 'vite.config.ts'), root: appRoot, publicDir: resolve(ROOT, 'public'), logLevel: 'warn', server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const base = server.resolvedUrls.local[0];
const ctx = await chromium.launchPersistentContext(resolve(out, 'profile'), {
  executablePath: exe, headless: true, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
});
const results = [];
try {
  const page = ctx.pages()[0] ?? await ctx.newPage();
  let log = [];
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/status of 404/.test(m.text())) log.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => log.push(`pageerror: ${e.message}`));
  // Encode the 210-t2 recipe with the game's own module, from a blank page on the dev server.
  await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 600000 });
  const trk = await page.evaluate(async r => (await import('/src/ui/seedModel.ts')).encodeRecipe(r), track.recipe);
  const adapter = await page.evaluate(async () => { const a = await navigator.gpu?.requestAdapter(); return a ? { vendor: a.info?.vendor, arch: a.info?.architecture, desc: a.info?.description } : null; });
  console.log('adapter', JSON.stringify(adapter));
  for (const world of worlds) for (const quality of qualities) for (const hour of hours) {
    const q = world === 'park' ? `world=theme-park&seed=1337` : `trk=${encodeURIComponent(trk)}&seed=${track.terrainSeed}`;
    const url = `${base}?${q}&quality=${quality}&t=${hour}&autostart=1&scenario=hover`;
    const name = `${world}-${quality}-${hour}`;
    log = [];
    let release;
    for (let tries = 0; !release; tries++) {
      try { release = await acquireGpuLock(); } catch (e) { if (tries > 2000 || !/locked/.test(e.message)) throw e; await new Promise(d => setTimeout(d, 3000)); }
    }
    const r = { name, url };
    try {
      const t0 = Date.now();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 600000 });
      await page.waitForFunction(() => window.__fpv?.ready === true || window.__fpv?.error, null, { timeout: 900000, polling: 500 });
      r.readyS = (Date.now() - t0) / 1000;
      r.error = await page.evaluate(() => window.__fpv.error ?? null);
      // 10 s of the live loop: rAF intervals in the page, then the renderer's own numbers.
      r.frames = await page.evaluate(() => new Promise(done => {
        const ts = []; const end = performance.now() + 10000;
        const tick = t => { ts.push(t); if (t < end) requestAnimationFrame(tick); else done(ts); };
        requestAnimationFrame(tick);
      }));
      const d = r.frames.slice(1).map((t, i) => t - r.frames[i]).sort((a, b) => a - b);
      r.frameMs = { n: d.length, p50: +d[Math.floor(d.length * 0.5)]?.toFixed(1), p95: +d[Math.floor(d.length * 0.95)]?.toFixed(1), max: +d[d.length - 1]?.toFixed(1) };
      delete r.frames;
      r.stats = await page.evaluate(() => { const s = window.__fpv.stats ?? {}; return { gpuMs: s.gpuMs, fps: s.fps, renderScale: s.renderScale, quality: s.quality, errorCount: s.errorCount, passMs: s.passMs }; });
      await page.screenshot({ path: resolve(out, `${name}.png`) });
    } catch (e) { r.fail = String(e.message ?? e).slice(0, 400); }
    finally { await release(); }
    r.console = log;
    results.push(r);
    console.log(JSON.stringify(r));
  }
} finally {
  await writeFile(resolve(out, args.results ?? 'results.json'), JSON.stringify(results, null, 1));
  await ctx.close(); await server.close();
}
