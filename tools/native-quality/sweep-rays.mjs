import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const giPath = 'src/render/shaders/rt/gi.wgsl', indexPath = 'src/render/rt/index.ts';
const serial = await read(giPath), index = await read(indexPath);
const paired = await read('.bench/research-20261005/e01-gi.wgsl');
const variants = [[8, 2], [4, 4], [16, 1], [8, 4], [4, 8], [16, 2]].map(([x,y], i) => ({
  id: `E${i+14}`, label: `Parallel GI rays ${x}x${y}x2`,
  hypothesis: 'Trace the existing two GI samples in separate z lanes using smaller groups than rejected E01; preserve sample order and ray count while reducing per-lane loop state',
  files: {
    [giPath]: paired.replace('array<vec4f, 128>', `array<vec4f, ${x*y*2}>`).replace('@workgroup_size(8, 8, 2)', `@workgroup_size(${x}, ${y}, 2)`).replaceAll('local + 64u', `local + ${x*y}u`),
    [indexPath]: index.replace(/this\.traced\(this\.pipes\.trace\[sig\][^\n]+/,
      `this.traced(this.pipes.trace[sig], groups.trace[sig]![par], sig === 'gi' ? Math.ceil(this.rc.gbuf.rtWidth / ${x}) : this.wx, sig === 'gi' ? Math.ceil(this.rc.gbuf.rtHeight / ${y}) : this.wy, 1);`),
  },
}));
const start = serial.indexOf('  for (var r = 0u; r < rays; r++) {');
const end = serial.indexOf('  let inv = 1.0 / f32(rays);');
if (start < 0 || end < 0) throw new Error('Expected serial GI loop');
const loop = serial.slice(start, end), body = loop.slice(loop.indexOf('{')+1, loop.lastIndexOf('}'));
variants.push({ id: 'E20', label: 'Unroll two-ray GI path', hypothesis: 'Specialize the existing two-ray case into two explicit ordered blocks to reduce dynamic loop state and improve compiler scheduling; other counts retain the original loop',
  files: { [giPath]: serial.slice(0,start)+`  if (rays == 2u) {\n    { let r = 0u;${body}    }\n    { let r = 1u;${body}    }\n  } else {\n${loop}  }\n`+serial.slice(end) } });
await explore('overnight-rays', variants, resolve(evidence, 'overnight-control-0.json'), 'E05');
