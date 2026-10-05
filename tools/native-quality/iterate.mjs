// One-command screening using the existing artifact builder and native runner.
// No timing cache, reduced frame counts or concurrent GPU jobs.
import { spawn } from 'node:child_process';
import { readFile, writeFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, parseArgs, checkArgs, stable } from '../native-bench/common.mjs';
import { buildArtifact } from '../native-bench/artifact.mjs';

const args = parseArgs(process.argv.slice(2));
checkArgs(args, ['id', 'label', 'hypothesis', 'change', 'quality', 'quick', 'reference', 'dry-run', 'help']);
if (args.help) {
  console.log('node tools/native-quality/iterate.mjs --id E06 --label "Short name" --hypothesis "Expected benefit" --change "Code changed" [--quick | --quality] [--reference <incumbent-run.json>] [--dry-run]');
  console.log('Builds an immutable artifact, runs the fixed 4K screen and updates the TSV. --quick checks the two existing native snapshots against ORIGINAL; --quality runs a full untimed replay instead. --reference selects an incumbent for performance triage only. Final review and confirmation remain separate.');
  process.exit(0);
}
for (const key of ['id', 'label', 'hypothesis', 'change']) {
  if (typeof args[key] !== 'string' || !args[key].trim()) throw new Error(`--${key} required`);
}
const id = args.id.toUpperCase();
if (!/^E\d{2,4}$/.test(id)) throw new Error('Use an iteration ID such as E06');
const logPath = resolve(ROOT, 'PERFORMANCE_4K_ULTRA.json');
const log = JSON.parse(await readFile(logPath, 'utf8'));
if (log.experiments.some(e => e.id === id)) throw new Error(`${id} already exists; use a fresh iteration ID`);
const evidence = resolve(ROOT, log.evidenceDirectory), prefix = id.toLowerCase();
const originalPath = resolve(evidence, 'quality-original-1.json');
const original = JSON.parse(await readFile(originalPath, 'utf8'));
if (original.artifact !== log.baselineArtifact || original.status !== 'valid') throw new Error('Original reference unavailable');
const tolerance = JSON.parse(await readFile(resolve(evidence, 'rounding-tolerances.json'), 'utf8'));
if (tolerance.candidateDataUsed !== false || tolerance.ssimMinimum !== .98) throw new Error('Independent calibration required');
const fixed = ['--workload', 'fpv-flight', '--quality', 'ultra', '--size', '3840x2160', '--scale', '1', '--warmup', '180', '--frames', '300', '--backend', 'd3d12'];
const screenPath = resolve(evidence, `${prefix}-screen.json`);
if (args['dry-run']) {
  console.log(JSON.stringify({ id, screenPath, fixed, baseline: originalPath, quality: !!args.quality, writes: false }, null, 2));
  process.exit(0);
}
const started = performance.now();
const experiment = { id, label: args.label, hypothesis: args.hypothesis, change: args.change, status: 'Building immutable artifact', startedAt: new Date().toISOString(), stageSeconds: {} };
log.experiments.push(experiment);
const save = () => writeFile(logPath, JSON.stringify(log, null, 2)+'\n');
const child = async (program, argv, name) => {
  const stageStart = performance.now();
  const output = await open(resolve(evidence, `${prefix}-${name}.console.txt`), 'wx');
  try {
    const code = await new Promise((accept, reject) => {
      const proc = spawn(program, argv, { cwd: ROOT, windowsHide: true, stdio: ['ignore', output.fd, output.fd] });
      proc.once('error', reject); proc.once('close', accept);
    });
    if (code !== 0) throw new Error(`${name} failed (exit ${code}); see preserved console log`);
  } finally { await output.close(); experiment.stageSeconds[name] = (performance.now()-stageStart)/1000; }
};
await save();
try {
  const buildStart = performance.now();
  const artifact = await buildArtifact(); // Same implementation as npm run bench:artifact.
  experiment.stageSeconds.build = (performance.now()-buildStart)/1000;
  experiment.artifact = artifact.manifest.id;
  experiment.status = 'Screening'; await save();
  console.log(`${id}: artifact ${experiment.artifact}; serialized native screen`);
  await child(process.execPath, ['tools/bench-native.mjs', 'run', '--artifact', artifact.path, ...fixed, '--out', screenPath], 'screen');
  const screen = JSON.parse(await readFile(screenPath, 'utf8'));
  if (screen.status !== 'valid') throw new Error('Invalid screen');
  for (const key of ['options', 'settings', 'workload', 'adapter', 'environment']) {
    if (stable(screen[key]) !== stable(original[key])) throw new Error(`${key} changed; independently recapture and calibrate the original before proceeding`);
  }
  const references = args.reference ? [JSON.parse(await readFile(resolve(args.reference), 'utf8'))] :
    await Promise.all([0, 1, 2].map(async i => JSON.parse(await readFile(resolve(evidence, `repeat-${i}.json`), 'utf8'))));
  for (const reference of references) {
    if (reference.status !== 'valid' || ['options', 'settings', 'workload', 'adapter', 'environment'].some(k => stable(reference[k]) !== stable(screen[k]))) throw new Error('Incompatible performance reference');
  }
  experiment.performanceReference = args.reference ?? 'original repeatability runs';
  const mean = key => references.reduce((sum, r) => sum+r.timing.gpuFrameMs[key], 0)/references.length;
  const promising = screen.timing.gpuFrameMs.mean < mean('mean')*(args.reference ? .995 : .98) && screen.timing.gpuFrameMs.p95 < mean('p95');
  experiment.status = promising ? 'Promising screen; final quality and paired comparisons pending' : `Screen did not improve reference mean by ${args.reference ? '0.5' : '2'}% and p95; not retained`;
  await save();
  console.log(`${id}: GPU ${screen.timing.gpuFrameMs.mean.toFixed(3)} ms; ${experiment.status}`);
  if (promising && args.quick && !args.quality) {
    // Reuse the runner's two native readbacks: no second GPU flight or 45-image replay.
    // The incumbent is used only for performance triage; images always use ORIGINAL.
    await child('python', ['tools/native-quality/evaluate.py', '--baseline', resolve(evidence, 'repeat-0.json'), '--candidate', screenPath,
      '--out', resolve(evidence, `${prefix}-quality.json`)], 'quick-quality');
    // The same readbacks already contain the native paired runner's byte metrics.
    // Apply its existing, independently calibrated bounds now to avoid spending
    // a full replay and comparison on a candidate that cannot pass that gate.
    const quick = JSON.parse(await readFile(resolve(evidence, `${prefix}-quality.json`), 'utf8'));
    experiment.pairedImagePrecheck = { imageRmse: quick.maxRmse, imageMax: quick.maxByteDifference,
      limitRmse: tolerance.imageRmse, limitMax: tolerance.imageMax,
      passed: quick.maxRmse <= tolerance.imageRmse && quick.maxByteDifference <= tolerance.imageMax };
    if (!experiment.pairedImagePrecheck.passed) throw new Error('Quick SSIM passed, but existing independently calibrated paired image bounds failed');
    experiment.status = 'Promising: two original-baseline SSIM/state checks passed; full final validation pending';
  }
  if (promising && args.quality) {
    const capture = resolve(evidence, `quality-${prefix}.json`), quality = resolve(evidence, `${prefix}-quality-full.json`);
    await child(process.execPath, ['tools/native-quality/capture.mjs', '--artifact', artifact.path, '--out', capture], 'capture');
    // CPU analysis starts after the GPU replay child has exited.
    await child('python', ['tools/native-quality/evaluate.py', '--baseline', originalPath, '--candidate', capture, '--out', quality], 'quality');
    await child('python', ['tools/native-quality/review.py', '--baseline', originalPath, '--candidate', capture, '--out', resolve(evidence, `review-${prefix}`)], 'review');
    experiment.status = 'Full numerical quality passed; review native sheets, then run three fresh pairs before retention';
    const compare = ['npm', 'run', 'bench:compare', '--', '--baseline', resolve(ROOT, '.bench/artifacts', log.baselineArtifact),
      '--candidate', artifact.path, ...fixed, '--pairs', '3', '--max-pairs', '3', '--keep-images',
      '--image-rmse', String(tolerance.imageRmse), '--image-max', String(tolerance.imageMax), '--out', resolve(evidence, `${prefix}-compare.json`)];
    const quote = v => /^[\w:./=-]+$/.test(v) ? v : `'${v.replaceAll("'", "''")}'`;
    console.log(`After native visual review, run fresh comparisons:\n${compare.map(quote).join(' ')}`);
  }
} catch (error) {
  experiment.status = `Not retained: ${error.message}`;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  experiment.elapsedSeconds = (performance.now()-started)/1000;
  await save();
  await child(process.execPath, ['tools/native-quality/log.mjs'], 'table');
}
