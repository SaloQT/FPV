#!/usr/bin/env node
/** The browser half of tools/pilot-lap-video.mjs: in headless Chromium, through the Vite dev server (tools/pilot-lap-browser.html), renders
 * the audio of a recorded lap to <dir>/drone.wav and, with --osd WxH, draws the game's FPV OSD for every frame to <dir>/osd/NNNNN.png.
 *
 *   node tools/pilot-lap-browser.mjs <telemetry.json> <dir> [--osd 1920x1080] [--no-audio]
 *
 * CHROME_BIN picks the browser; otherwise the newest Playwright Chromium, then Edge. */
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const argv = process.argv.slice(2), [telemetryFile, dir] = argv.filter((v, i) => !v.startsWith('--') && !argv[i - 1]?.startsWith('--osd'));
if (!telemetryFile || !dir) throw new Error('usage: node tools/pilot-lap-browser.mjs <telemetry.json> <dir> [--osd 1920x1080] [--no-audio]');
const osdSize = argv.includes('--osd') ? argv[argv.indexOf('--osd') + 1].split('x').map(Number) : null, audio = !argv.includes('--no-audio');
const pw = join(homedir(), 'AppData/Local/ms-playwright');
const playwrightChrome = existsSync(pw) ? readdirSync(pw).filter(d => /^chromium-\d+$/.test(d)).sort((p, q) => Number(q.slice(9)) - Number(p.slice(9))).map(d => join(pw, d, 'chrome-win64/chrome.exe')).find(existsSync) : undefined;
const exe = process.env.CHROME_BIN ?? playwrightChrome ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

// No file watching or live reload: other work edits the source while a video renders, and a reload would wipe the page mid-render.
const server = await createServer({ configFile: resolve('vite.config.ts'), logLevel: 'warn', server: { port: 0, host: '127.0.0.1', hmr: false, watch: { ignored: ['**/*'] } } });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: osdSize ? { width: osdSize[0], height: osdSize[1] } : undefined, deviceScaleFactor: 1 });
  // The page's own favicon request is the only 404 it makes; anything else is reported.
  page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/status of 404/.test(m.text())) console.log(`page ${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => console.error(`page error: ${e.message}`));
  // The dev server compiles the page's modules on the first load, which takes minutes while training and other work share the CPU.
  await page.goto(new URL('tools/pilot-lap-browser.html', url).href, { timeout: 600000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.setTelemetry !== undefined, null, { timeout: 600000 });
  const telemetry = JSON.parse(await readFile(resolve(telemetryFile), 'utf8')), n = telemetry.frames.length;
  await page.evaluate(t => window.setTelemetry(t), telemetry);

  if (osdSize) {
    const began = performance.now(), osdDir = resolve(dir, 'osd');
    await rm(osdDir, { recursive: true, force: true }); await mkdir(osdDir, { recursive: true });
    await page.evaluate(([w, h]) => window.startOsd(w, h), osdSize);
    for (let from = 0; from < n; from += 120) {
      const pngs = await page.evaluate(([p, q]) => window.osdFrames(p, q), [from, Math.min(n, from + 120)]);
      await Promise.all(pngs.map((b, k) => writeFile(resolve(osdDir, `${String(from + k).padStart(5, '0')}.png`), Buffer.from(b, 'base64'))));
    }
    console.log(`Drew ${n} OSD frames (${osdSize.join('x')}) in ${((performance.now() - began) / 1000).toFixed(0)} s`);
  }

  if (audio) {
    const began = performance.now(), out = resolve(dir, 'drone.wav');
    const r = await page.evaluate(() => window.renderLap());
    const pcm = Buffer.concat(r.chunks.map(c => Buffer.from(c, 'base64')));
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12); header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(r.rate, 24); header.writeUInt32LE(r.rate * 4, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    await writeFile(out, Buffer.concat([header, pcm]));
    console.log(`Wrote ${out}: ${(pcm.length / 4 / r.rate).toFixed(1)} s, peak ${r.peak.toFixed(3)}, ${r.synth} motor synth, ${((performance.now() - began) / 1000).toFixed(0)} s`);
    if (r.synth === 'none' || r.peak < 1e-4) throw new Error('The audio came out silent');
  }
} finally { await browser.close(); await server.close(); }
