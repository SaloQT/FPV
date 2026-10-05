import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, percentile, parseArgs, checkArgs } from '../native-bench/common.mjs';
const args = parseArgs(process.argv.slice(2));
checkArgs(args, ['id', 'metadata']);
const id = String(args.id ?? 'E05').toUpperCase(), prefix = id.toLowerCase();
if (!/^E\d{2,4}$/.test(id)) throw new Error('Invalid iteration ID');
const evidence = resolve(ROOT, '.bench/research-20261005');
const json = async name => JSON.parse(await readFile(resolve(evidence, name), 'utf8'));
const comparison = await json(`${prefix}-final.json`), quality = await json(`${prefix}-quality-full.json`);
const snapshots = await json(`${prefix}-final-snapshots-quality.json`), visual = await json(`${prefix}-visual-review.json`);
const metadata = args.metadata ? JSON.parse(await readFile(resolve(ROOT, args.metadata), 'utf8')) : null;
if (id !== 'E05' && (!metadata || metadata.artifact !== comparison.candidate || metadata.validation?.productionBuild !== 'passed' ||
  !metadata.validation?.targetedRenderingTests || !metadata.changes?.length)) throw new Error('Finalist-specific build/test and change metadata required');
const preserved = await json('preservation-verification.json');
if (comparison.status !== 'valid' || comparison.verdict !== 'improved' || comparison.completedPairs !== 9 || comparison.correctness !== 'passed' ||
  !quality.passed || !quality.exactState || quality.checkedStateFrames !== 480 || !quality.oracleUnchanged || !snapshots.passed || !snapshots.exactStates || !preserved.passed ||
  visual.result !== 'passed sampled visual review' || visual.artifact !== comparison.candidate ||
  comparison.metrics.cpuCombinedMs.verdict === 'regressed') throw new Error('Final gate failed');
const baseline = [], candidate = [];
for (const pair of comparison.pairs) {
  baseline.push(JSON.parse(await readFile(pair.baselineFile, 'utf8')));
  candidate.push(JSON.parse(await readFile(pair.candidateFile, 'utf8')));
}
const mean = xs => xs.reduce((a, b) => a+b, 0)/xs.length;
const sampleKeys = { gpuFrameMs: 'gpuMs', cpuCombinedMs: 'cpuMs', cpuSimulationMs: 'simulationMs', cpuRenderMs: 'renderMs' };
const timing = runs => Object.fromEntries(['gpuFrameMs', 'cpuCombinedMs', 'cpuSimulationMs', 'cpuRenderMs'].map(k =>
  [k, { mean: mean(runs.map(r => r.timing[k].mean)), meanRunP95: mean(runs.map(r => r.timing[k].p95)),
    pooledP95: percentile(runs.flatMap(r => r.samples.map(s => s[sampleKeys[k]])), .95) }]));
const before = timing(baseline), after = timing(candidate);
if (after.gpuFrameMs.meanRunP95 >= before.gpuFrameMs.meanRunP95 || after.gpuFrameMs.pooledP95 >= before.gpuFrameMs.pooledP95) throw new Error('GPU p95 did not improve');
const report = {
  status: 'verified', selectedArtifact: comparison.candidate, originalArtifact: comparison.baseline,
  options: comparison.options, adapter: comparison.identity.adapter, finalFreshPairs: 9,
  measuredFramesPerArm: 2700, units: 'milliseconds; native offscreen GPU duration and synchronous CPU work are separate',
  before, after, gpuMeanSavedMs: before.gpuFrameMs.mean-after.gpuFrameMs.mean,
  gpuMeanPairedReductionPercent: comparison.metrics.gpuFrameMs.pairedMeanReductionPercent,
  gpuMeanReduction95IntervalPercent: comparison.metrics.gpuFrameMs.interval95Percent,
  gpuP95SavedMs: before.gpuFrameMs.pooledP95-after.gpuFrameMs.pooledP95,
  cpuVerdict: comparison.metrics.cpuCombinedMs.verdict, cpuReduction95IntervalPercent: comparison.metrics.cpuCombinedMs.interval95Percent,
  cpuAssessment: {
    meanChangeMs: after.cpuCombinedMs.mean-before.cpuCombinedMs.mean,
    meanChangePercent: 100*(after.cpuCombinedMs.mean/before.cpuCombinedMs.mean-1),
    existingRegressionGatePassed: comparison.metrics.cpuCombinedMs.verdict !== 'regressed',
    nonRegressionEstablished: comparison.metrics.cpuCombinedMs.interval95Percent[0] >= -comparison.comparison.threshold,
    note: 'Passing the existing significance-based regression gate does not establish CPU non-inferiority when its uncertainty interval still allows a meaningful regression.'
  },
  quality: { nativeImages: quality.samples.length, finalPairImages: snapshots.imageComparisons,
    minimumSsim: Math.min(quality.minSsim, snapshots.minSsim), threshold: .98, exactFlightStates: quality.checkedStateFrames,
    maxFullReplayByteDifference: quality.maxByteDifference,
    allGpuRayAnswersUnchanged: quality.oracleUnchanged, visualReview: visual.result, temporalTransitions: quality.temporalResidual.length,
    maxTemporalRgbRmse: Math.max(...quality.temporalResidual.map(t => t.rgbRmse)) },
  changes: metadata?.changes ?? ['GI dispatches 8x4 workgroups instead of 8x8 with unchanged rays, samples and resolution.',
    'BVH traversal carries the immediately visited near child in scalar state, avoiding its stack write/read while preserving visits and caps.'],
  validation: { ...(metadata?.validation ?? { productionBuild: 'passed', targetedRenderingTests: 126, ssimEvaluatorTests: 4 }), frozenSourceFilesVerified: preserved.frozenSourceFiles },
  ...(metadata?.tradeoffs ? { tradeoffs: metadata.tradeoffs } : {}),
  ...(metadata?.workflow ? { workflow: metadata.workflow } : {}),
  limitations: ['Sampled visual review and SSIM do not prove perceived quality across all scenes or frames.',
    ...(comparison.metrics.cpuCombinedMs.interval95Percent[0] < -comparison.comparison.threshold
      ? ['CPU non-regression is not established: the paired interval still permits a meaningful regression. Report the observed CPU means and uncertainty separately from GPU gains.'] : []),
    'The original ray oracle has nine BVH/CPU discrepancies out of 1000; candidate preserves all 2000 GPU ray answers exactly, including the 1000 passing terrain rays.',
    'Results cover the fixed fpv-flight, 4K Ultra, RX 9070 XT, D3D12 configuration. Browser presentation latency and other hardware were not measured.']
};
await writeFile(resolve(evidence, `${prefix}-verified-result.json`), JSON.stringify(report, null, 2)+'\n');
await writeFile(resolve(evidence, 'verified-result.json'), JSON.stringify(report, null, 2)+'\n');
const logPath = resolve(ROOT, 'PERFORMANCE_4K_ULTRA.json'), log = JSON.parse(await readFile(logPath, 'utf8'));
log.final = report;
log.experiments.find(e => e.id === id).status = 'Retained under existing native benchmark gates: nine fresh pairs, full SSIM/visual review, exact states/ray answers, build/tests passed.' +
  (report.cpuAssessment.nonRegressionEstablished ? '' : ` CPU mean change ${report.cpuAssessment.meanChangeMs.toFixed(3)} ms; CPU non-regression remains unproven.`);
for (const experiment of log.experiments) {
  if (experiment.id !== id && /^Provisional/i.test(experiment.status)) {
    experiment.explorationDecision ??= experiment.status;
    experiment.status = `Exploratory improvement; superseded by ${id}; no independent nine-pair confirmation.`;
  }
}
if (id !== 'E05') log.experiments.find(e => e.id === 'E05').status = `Verified by nine pairs and full quality; superseded by faster verified ${id}.`;
log.experiments.find(e => e.id === 'E03').status = `Verified by three pairs and full quality; superseded by faster verified ${id}.`;
await writeFile(logPath, JSON.stringify(log, null, 2)+'\n');
console.log(JSON.stringify(report, null, 2));
