// Small reusable serial loop for overnight candidate screening.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from '../native-bench/common.mjs';
export const evidence = resolve(ROOT, '.bench/research-20261005');
export const read = path => readFile(resolve(ROOT, path), 'utf8');
const exec = promisify(execFile);
async function waitForHost() {
  const started=Date.now();
  let quiet = 0;
  for (;;) {
    if (Date.now() >= Date.parse('2026-10-04T20:15:00Z')) throw new Error('Exploration cutoff reached; reserve the remaining night for final confirmation');
    const {stdout}=await exec('pwsh',['-NoProfile','-NonInteractive','-Command',"(Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor | Where-Object Name -eq '_Total').PercentProcessorTime"],{windowsHide:true,timeout:15000,maxBuffer:4096});
    const cpu=Number(stdout.trim());
    if(!Number.isFinite(cpu)||cpu<0||cpu>100)throw new Error('Could not read host CPU utilization');
    quiet = cpu < 50 ? quiet + 1 : 0;
    const result={checkedAt:new Date().toISOString(),cpuPercent:cpu,quietReadings:quiet,requiredQuietReadings:3,cpuLimitPercent:50,waitSeconds:(Date.now()-started)/1000};
    await writeFile(resolve(evidence,'overnight-host-wait.json'),JSON.stringify(result,null,2)+'\n');
    if(quiet>=3)return result;
    if(cpu>=50)console.log(`Waiting for external CPU load: ${cpu}%`);
    await new Promise(accept=>setTimeout(accept,cpu<50?3000:10000));
  }
}
export const child = argv => new Promise((accept, reject) => {
  const p = spawn(process.execPath, argv, { cwd: ROOT, windowsHide: true, stdio: 'inherit' });
  p.once('error', reject); p.once('close', accept);
});
export async function explore(name, variants, referencePath, parent) {
  const paths = [...new Set(variants.flatMap(v => Object.keys(v.files)))];
  const original = Object.fromEntries(await Promise.all(paths.map(async p => [p, await read(p)])));
  const control = JSON.parse(await readFile(referencePath, 'utf8'));
  let best = { id: parent, gpu: control.timing.gpuFrameMs.mean, files: original, artifact: typeof control.artifact === 'string' ? control.artifact : control.artifact.id };
  // Preserve the incumbent bytes for every file this batch can touch.
  for (const [p, text] of Object.entries(original)) {
    const saved=resolve(evidence, `${name}-base-source`, p);
    await mkdir(dirname(saved), {recursive:true});
    await writeFile(saved, text, {flag:'wx'});
  }
  await writeFile(resolve(evidence, `${name}-base.json`),JSON.stringify({parent,artifact:best.artifact,paths},null,2)+'\n',{flag:'wx'});
  const apply = async files => { for (const [p, text] of Object.entries(files)) await writeFile(resolve(ROOT, p), text); };
  try {
    for (const v of variants) {
      const host=await waitForHost();
      const code = { ...original, ...v.files }, prefix = v.id.toLowerCase();
      for (const [p, text] of Object.entries(code)) {
        const saved = resolve(evidence, `${prefix}-source`, p);
        await mkdir(dirname(saved), { recursive: true }); await writeFile(saved, text);
      }
      await apply(code);
      const exit = await child(['tools/native-quality/iterate.mjs', '--id', v.id, '--label', v.label,
        '--hypothesis', v.hypothesis, '--change', v.change ?? Object.keys(v.files).join(', '), '--quick', '--reference', referencePath]);
      const logPath = resolve(ROOT, 'PERFORMANCE_4K_ULTRA.json'), log = JSON.parse(await readFile(logPath, 'utf8'));
      const entry = log.experiments.find(e => e.id === v.id);
      if (!entry) throw new Error(`${v.id} failed before recording an iteration`);
      entry.parentIteration = parent;
      entry.sourceFiles=Object.keys(v.files);
      entry.hostBeforeRun=host;
      if (exit === 0) {
        const screen = JSON.parse(await readFile(resolve(evidence, `${prefix}-screen.json`), 'utf8'));
        let q; try { q = JSON.parse(await readFile(resolve(evidence, `${prefix}-quality.json`), 'utf8')); } catch {}
        if (q?.passed && q.exactState && screen.timing.gpuFrameMs.mean < best.gpu*.995) {
          best = { id: v.id, gpu: screen.timing.gpuFrameMs.mean, files: code, artifact: entry.artifact };
          entry.status = 'Provisional sweep leader: two original-baseline SSIM/state checks passed; full final validation pending';
        } else if (q?.passed) entry.status = 'Quick quality passed; no improvement over current sweep leader';
      }
      await writeFile(logPath, JSON.stringify(log, null, 2)+'\n');
      await child(['tools/native-quality/log.mjs']);
      // Leave the provisional leader in the checkout while waiting for the next
      // host-load window; rejected bytes remain in the immutable artifact/backup.
      await apply(best.files);
      console.log(`SWEEP ${v.id}: ${entry.status}; best=${best.id} ${best.gpu.toFixed(3)} ms`);
      if (exit !== 0) {
        let failedScreen;
        try { failedScreen=JSON.parse(await readFile(resolve(evidence, `${prefix}-screen.json`), 'utf8')); } catch {}
        if (failedScreen?.status !== 'valid') throw new Error(`${v.id}: native screen failed; stop this batch and inspect the preserved error before launching another variant`);
      }
    }
  } finally {
    await apply(best.files);
    await writeFile(resolve(evidence, `${name}-winner.json`), JSON.stringify({ id: best.id, artifact: best.artifact, gpuMeanMs: best.gpu, provisional: true }, null, 2)+'\n');
  }
  return best;
}
