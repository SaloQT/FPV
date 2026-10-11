// Screenshots the prop lab page at two window sizes and measures overflow.
// Usage: start `npx vite --port 5199`, then `node tools/prop-lab/shots.mjs [http://localhost:5199]`.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './bundle.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const base = process.argv[2] ?? 'http://localhost:5199';
const exe = join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1243', 'chrome-win64', 'chrome.exe');
const out = join(ROOT, '.bench', 'prop-lab', 'shots');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader'] });
let bad = 0;
for (const [w, h] of [[1920, 1080], [2560, 1440]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto(`${base}/?mode=proplab`);
  await page.waitForFunction(() => window.__fpv?.ready === true, null, { timeout: 60000 });
  await page.click('.pl-row >> nth=0');
  await page.click('button:has-text("Copy")');
  await page.click('.pl-row >> nth=0');
  await page.fill('input[type=number] >> nth=0', '30');
  await page.click('button:has-text("Run optimiser")');
  await page.waitForTimeout(12000);
  await page.screenshot({ path: join(out, `proplab-${w}x${h}.png`) });
  const res = await page.evaluate(() => {
    const de = document.documentElement, pl = document.querySelector('.pl');
    const problems = [];
    for (const e of pl.querySelectorAll('*')) {
      if (e.hidden || e.closest('[hidden]')) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none') continue;
      const cr = e.closest('.pl-col, .pl-head')?.getBoundingClientRect();
      const r = e.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5) problems.push(`${e.tagName}.${e.className} off window`);
      else if (cr && e.tagName !== 'CANVAS' && (r.right > cr.right + 0.5 || r.bottom > cr.bottom + 0.5)) problems.push(`${e.tagName}.${e.className} past its panel`);
      if (e.scrollWidth > e.clientWidth + 1 && cs.overflow !== 'hidden' && e.tagName !== 'INPUT') problems.push(`${e.tagName}.${e.className} sideways scroll`);
    }
    return { doc: [de.scrollWidth, de.clientWidth, de.scrollHeight, de.clientHeight], problems: problems.slice(0, 12) };
  });
  const [sw, cw, sh, ch] = res.doc;
  console.log(`${w}x${h}: doc scroll ${sw}x${sh} vs ${cw}x${ch}; problems ${res.problems.length}`, res.problems);
  if (sw > cw || sh > ch || res.problems.length) bad++;
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
