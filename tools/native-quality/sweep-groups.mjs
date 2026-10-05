// Bounded serial exploration; every candidate changes GI dispatch shape only.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../native-bench/common.mjs';
const evidence = resolve(ROOT, '.bench/research-20261005');
const files = ['src/render/shaders/rt/gi.wgsl', 'src/render/rt/index.ts'];
const base = await Promise.all(files.map(f => readFile(resolve(evidence, 'overnight-e05-source', f), 'utf8')));
const controlPath = resolve(evidence, 'overnight-control-0.json');
const control = JSON.parse(await readFile(controlPath, 'utf8'));
const logPath = resolve(ROOT, 'PERFORMANCE_4K_ULTRA.json');
const run = argv => new Promise((accept, reject) => {
  const child = spawn(process.execPath, argv, { cwd: ROOT, windowsHide: true, stdio: 'inherit' });
  child.once('error', reject); child.once('close', accept);
});
let best = { id: 'E05', gpu: control.timing.gpuFrameMs.mean, code: base };
const variants = [[16, 2], [32, 1], [4, 8], [8, 2], [16, 4], [4, 4], [2, 16], [1, 32]];
try {
  for (let i=0; i<variants.length; i++) {
    const [x,y] = variants[i], id = `E${String(i+6).padStart(2, '0')}`, prefix = id.toLowerCase();
    const code = [base[0].replace('@workgroup_size(8, 4)', `@workgroup_size(${x}, ${y})`),
      base[1].replace('this.wx, sig === \'gi\' ? Math.ceil(this.rc.gbuf.rtHeight / 4) : this.wy',
        `sig === 'gi' ? Math.ceil(this.rc.gbuf.rtWidth / ${x}) : this.wx, sig === 'gi' ? Math.ceil(this.rc.gbuf.rtHeight / ${y}) : this.wy`)];
    for (let j=0; j<files.length; j++) {
      const preserved = resolve(evidence, `${prefix}-source`, files[j]);
      await mkdir(dirname(preserved), { recursive: true });
      await writeFile(preserved, code[j]); await writeFile(resolve(ROOT, files[j]), code[j]);
    }
    const exit = await run(['tools/native-quality/iterate.mjs', '--id', id, '--label', `GI ${x}x${y} groups`,
      '--hypothesis', `Reshape GI to ${x}x${y} lanes to improve occupancy or spatial coherence without changing rays or arithmetic`,
      '--change', 'GI workgroup dimensions and matching GI-only dispatch dimensions; based on retained E05', '--quick', '--reference', controlPath]);
    const log = JSON.parse(await readFile(logPath, 'utf8')), entry = log.experiments.find(e => e.id === id);
    if (exit === 0) {
      const screen = JSON.parse(await readFile(resolve(evidence, `${prefix}-screen.json`), 'utf8'));
      let q; try { q = JSON.parse(await readFile(resolve(evidence, `${prefix}-quality.json`), 'utf8')); } catch {}
      if (q?.passed && q.exactState && screen.timing.gpuFrameMs.mean < best.gpu*.995) {
        best = { id, gpu: screen.timing.gpuFrameMs.mean, code };
        entry.status = 'Provisional sweep leader: two original-baseline images and states passed; final validation pending';
      } else if (q?.passed) entry.status = 'Quick quality passed; no improvement over current sweep leader';
    }
    await writeFile(logPath, JSON.stringify(log, null, 2)+'\n');
    await run(['tools/native-quality/log.mjs']);
    console.log(`SWEEP ${id}: ${entry.status}; best=${best.id} ${best.gpu.toFixed(3)} ms`);
  }
} finally {
  for (let j=0; j<files.length; j++) await writeFile(resolve(ROOT, files[j]), best.code[j]);
  await writeFile(resolve(evidence, 'overnight-group-winner.json'), JSON.stringify({ id: best.id, gpuMeanMs: best.gpu, provisional: true }, null, 2)+'\n');
}
