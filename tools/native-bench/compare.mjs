import { mkdir, readFile, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { stable, sha256, percentile, writeJson } from './common.mjs';
import { loadArtifact } from './artifact.mjs';
import { runChild } from './runner.mjs';

export const METRICS = ['gpuFrameMs', 'cpuCombinedMs', 'cpuSimulationMs', 'cpuRenderMs'];
export function compareOptions(args) {
  const integer = (key, fallback, min, max) => {
    const n = Number(args[key] ?? fallback);
    if (!Number.isInteger(n) || n < min || n > max || typeof args[key] === 'boolean') throw new Error(`--${key} must be an integer from ${min} to ${max}`);
    return n;
  };
  const minPairs = integer('pairs', 3, 3, 20), maxPairs = integer('max-pairs', 9, minPairs, 30);
  const threshold = Number(args.threshold ?? 2), imageRmse = Number(args['image-rmse'] ?? 0), imageMax = Number(args['image-max'] ?? 0);
  if (['threshold', 'image-rmse', 'image-max'].some(key => typeof args[key] === 'boolean') ||
    ![threshold, imageRmse, imageMax].every(Number.isFinite) || threshold <= 0 || threshold > 100 || imageRmse < 0 || imageRmse > 255 || imageMax < 0 || imageMax > 255) throw new Error('Invalid comparison/image tolerance');
  const metric = args.metric ?? 'gpuFrameMs';
  if (!METRICS.includes(metric)) throw new Error(`--metric must be one of ${METRICS.join(', ')}`);
  if (args['keep-images'] !== undefined && args['keep-images'] !== true) throw new Error('--keep-images is a flag');
  return { minPairs, maxPairs, threshold, imageRmse, imageMax, metric, keepImages: args['keep-images'] === true };
}
export const COMPARE_OPTIONS = ['pairs', 'max-pairs', 'threshold', 'image-rmse', 'image-max', 'metric', 'keep-images'];

async function correctness(baseline, candidate, baselinePath, candidatePath, config) {
  if (stable(baseline.settings) !== stable(candidate.settings) || stable(baseline.workload) !== stable(candidate.workload)) throw new Error('Settings or scene description differ');
  if (baseline.snapshots.length !== candidate.snapshots.length || baseline.snapshots.length < 2) throw new Error('Missing correctness checkpoints');
  const checks = [];
  for (let i = 0; i < baseline.snapshots.length; i++) {
    const a = baseline.snapshots[i], b = candidate.snapshots[i];
    if (a.frameIndex !== b.frameIndex || a.width !== b.width || a.height !== b.height || a.stateSha256 !== b.stateSha256) throw new Error('Workload/physics state diverged');
    // Paths come from our child runner, not artifact code. Reject separators nevertheless.
    if ([a.imageFile, b.imageFile].some(path => typeof path !== 'string' || /[\\/]/.test(path))) throw new Error('Invalid snapshot file');
    const old = await readFile(resolve(dirname(baselinePath), a.imageFile)), next = await readFile(resolve(dirname(candidatePath), b.imageFile));
    if (old.length !== a.width * a.height * 4 || next.length !== old.length || sha256(old) !== a.imageSha256 || sha256(next) !== b.imageSha256) throw new Error('Snapshot integrity mismatch');
    let squared = 0, max = 0;
    for (let p = 0; p < old.length; p++) { const delta = Math.abs(old[p] - next[p]); squared += delta * delta; max = Math.max(max, delta); }
    const rmse = Math.sqrt(squared / old.length);
    if (rmse > config.imageRmse || max > config.imageMax) throw new Error(`Image mismatch at frame ${a.frameIndex}: RMSE ${rmse}, max ${max}`);
    checks.push({ frameIndex: a.frameIndex, exact: a.imageSha256 === b.imageSha256, rmse, max });
  }
  return checks;
}
function interval(values) {
  const n = values.length, mean = values.reduce((a, b) => a + b, 0) / n;
  // Paired batch-level interval, never treating correlated frames as independent trials.
  const t95 = [Infinity, Infinity, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262,
    2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080,
    2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045];
  const variance = values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / Math.max(1, n - 1);
  const radius = n >= 3 ? t95[n] * Math.sqrt(variance / n) : Infinity;
  return { pairedMeanReductionPercent: mean, pairedMedianReductionPercent: percentile(values, .5),
    interval95Percent: Number.isFinite(radius) ? [mean - radius, mean + radius] : null, pairReductionsPercent: values };
}
function verdict(stat, threshold) {
  const ci = stat.interval95Percent;
  if (!ci) return 'no clear difference';
  if (ci[0] > threshold) return 'improved';
  if (ci[1] < -threshold) return 'regressed';
  return 'no clear difference';
}
export async function compareArtifacts(baselinePath, candidatePath, options, config, outputPath, signal) {
  const baseline = await loadArtifact(baselinePath), candidate = await loadArtifact(candidatePath);
  await mkdir(dirname(outputPath), { recursive: true });
  const pairs = [], result = { schemaVersion: 1, kind: 'paired-native-comparison', status: 'invalid',
    baseline: baseline.id, candidate: candidate.id, options, comparison: config, pairs,
    snapshotRetention: config.keepImages ? 'All snapshots retained' : 'Final and failing pairs retained; earlier passing images discarded',
    uncertaintyNote: 'Approximate paired Student-t intervals assume independent batch differences. Three-pair screening is exploratory; final decisions use maxPairs fresh pairs.' };
  let identity = null, finalIdentity = null;
  try {
    for (let pair = 0; pair < config.maxPairs; pair++) {
      const outputs = [resolve(dirname(outputPath), `${baseline.id.slice(0, 12)}-baseline-${pair}-${sha256(outputPath).slice(0, 12)}.json`),
        resolve(dirname(outputPath), `${candidate.id.slice(0, 12)}-candidate-${pair}-${sha256(outputPath).slice(0, 12)}.json`)];
      const runs = [];
      for (const side of pair % 2 ? [1, 0] : [0, 1]) {
        if (signal?.aborted) throw new Error('Comparison cancelled');
        runs[side] = await runChild(side ? candidatePath : baselinePath, options, outputs[side], signal);
        if (runs[side].status !== 'valid') throw new Error(`Invalid ${side ? 'candidate' : 'baseline'}: ${runs[side].faults.join('; ')}`);
        const current = stable({ environment: runs[side].environment, adapter: runs[side].adapter });
        identity ??= current;
        if (current !== identity) throw new Error('Runtime, driver or adapter changed during comparison');
        finalIdentity = { environment: runs[side].environment, adapter: runs[side].adapter };
      }
      const images = await correctness(runs[0], runs[1], outputs[0], outputs[1], config);
      pairs.push({ index: pair, order: pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'],
        baselineFile: outputs[0], candidateFile: outputs[1], correctness: images,
        baselineMs: Object.fromEntries(METRICS.map(name => [name, runs[0].timing[name].mean])),
        candidateMs: Object.fromEntries(METRICS.map(name => [name, runs[1].timing[name].mean])) });
      // Keep storage bounded when thousands of agents request paired measurements.
      if (!config.keepImages && pair < config.maxPairs - 1) {
        for (const side of [0, 1]) {
          for (const snapshot of runs[side].snapshots) {
            // correctness() has already validated these private runner-generated filenames.
            await unlink(resolve(dirname(outputs[side]), snapshot.imageFile)); snapshot.retained = false;
          }
          await writeJson(outputs[side], runs[side]);
        }
      }
      if (pairs.length >= config.minPairs) {
        result.metrics = Object.fromEntries(METRICS.map(name => {
          const values = pairs.map(p => 100 * (1 - p.candidateMs[name] / p.baselineMs[name]));
          if (!values.every(Number.isFinite)) throw new Error(`Invalid paired metric ${name}`);
          const stats = interval(values);
          return [name, { ...stats, verdict: verdict(stats, config.threshold) }];
        }));
        // Persist screening progress but don't stop early on a favorable noisy estimate.
        result.completedPairs = pairs.length; result.identity = finalIdentity;
        await writeJson(outputPath, result);
      }
    }
    result.status = 'valid';
    result.verdict = result.metrics[config.metric].verdict;
    if (result.metrics.cpuCombinedMs.verdict === 'regressed') result.verdict = 'regressed';
    result.correctness = 'passed';
  } catch (error) { result.fault = error.stack ?? String(error); result.verdict = 'invalid'; }
  result.finishedAt = new Date().toISOString();
  await writeJson(outputPath, result);
  return result;
}
