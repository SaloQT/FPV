// One screenshot of the running app on the real GPU (Edge, D3D12), for checking a quality tier boots. Start `npm run dev` first. Usage:
//   node tools/audit/shot-gpu.mjs "http://localhost:5173/?quality=extreme&autostart=1&scenario=hover" .bench/audit/extreme.png
// Prints the stats and every console error; exits 1 on an error. EDGE_BIN overrides the Edge path.
import { chromium } from 'playwright-core';

const [url, out] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: process.env.EDGE_BIN ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=WebGPU', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const errors = [];
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.stack ?? e.message));
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__fpv && (window.__fpv.ready || window.__fpv.error), null, { timeout: 300000 });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: out });
  const info = await page.evaluate(() => {
    const s = window.__fpv?.stats ?? {};
    return { error: window.__fpv?.error ?? null, quality: s.quality, tier: s.tier ?? s.qualityTier, dynamicDriver: s.dynamicDriver, gpuMs: s.gpuMs, fps: s.fps, adapter: s.adapter };
  });
  console.log(JSON.stringify({ url, out, info, errors }, null, 2));
  if (errors.length || info.error) code = 1;
} catch (e) {
  console.error('failed:', e);
  code = 1;
} finally {
  await browser.close();
}
process.exit(code);
