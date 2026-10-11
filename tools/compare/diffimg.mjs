// Writes an amplified difference image of two raw .rgba frames (shot-client --raw) and prints the largest channel difference and how many
// pixels differ. Needs ffmpeg on PATH.
//   node tools/compare/diffimg.mjs a.rgba b.rgba out.png width height [gain]
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [a, b, out, w, h, gain = '8'] = process.argv.slice(2);
const x = readFileSync(a), y = readFileSync(b), d = Buffer.alloc(x.length);
let max = 0, n = 0;
for (let i = 0; i < x.length; i += 4) {
  let m = 0;
  for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(x[i + c] - y[i + c]));
  if (m) n++;
  max = Math.max(max, m);
  const v = Math.min(255, m * Number(gain));
  d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
}
spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', '-', '-frames:v', '1', out], { input: d });
console.log(`max ${max}, ${n} pixels differ of ${x.length / 4}`);
