// Refresh the one-row-per-iteration TSV from preserved benchmark evidence.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from '../native-bench/common.mjs';
const evidence = resolve(ROOT, '.bench/research-20261005');
const optional = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const log = await optional(resolve(ROOT, 'PERFORMANCE_4K_ULTRA.json'));
const avg = values => values.reduce((a, b) => a + b, 0) / values.length;
const timings = runs => ({ gpu_mean_ms: avg(runs.map(r => r.timing.gpuFrameMs.mean)), gpu_p95_ms: avg(runs.map(r => r.timing.gpuFrameMs.p95)),
  cpu_mean_ms: avg(runs.map(r => r.timing.cpuCombinedMs.mean)), cpu_p95_ms: avg(runs.map(r => r.timing.cpuCombinedMs.p95)) });
const baseline = await Promise.all([0, 1, 2].map(i => optional(resolve(evidence, `repeat-${i}.json`))));
const repeat = await optional(resolve(evidence, 'quality-repeatability.json'));
const rows = [{ iteration: 'B00', hypothesis: 'Unchanged original baseline repeatability', artifact: log.baselineArtifact,
  phase: '3 fresh runs; 2 untimed replays', ...timings(baseline), min_ssim: repeat?.minSsim, quality_samples: repeat?.samples.length,
  state: 'exact', decision: 'reference', evidence: '.bench/research-20261005/repeat-{0,1,2}.json; quality-repeatability.json' }];
for (const experiment of log.experiments) {
  const id = experiment.id.toLowerCase();
  const screen = await optional(resolve(evidence, `${id}-screen.json`));
  const full = await optional(resolve(evidence, `${id}-quality-full.json`));
  const quality = full ?? await optional(resolve(evidence, `${id}-quality.json`));
  const final = await optional(resolve(evidence, `${id}-final.json`));
  const paired = final?.status === 'valid' ? final : await optional(resolve(evidence, `${id}-compare.json`));
  let runs = screen?.status === 'valid' && screen.timing ? [screen] : [];
  if (paired?.status === 'valid') runs = await Promise.all(paired.pairs.map(p => optional(p.candidateFile)));
  const row = { iteration: experiment.id, hypothesis: experiment.hypothesis, artifact: experiment.artifact,
    phase: paired?.status === 'valid' ? `${paired.completedPairs} fresh pairs` : screen ? 'single screen' : 'pending',
    ...(runs.length ? timings(runs) : {}), min_ssim: quality?.minSsim, quality_samples: quality?.samples.length,
    state: quality?.exactState ? 'exact' : 'pending', decision: experiment.status,
    elapsed_seconds: experiment.elapsedSeconds == null ? undefined : experiment.elapsedSeconds + (experiment.hostBeforeRun?.waitSeconds ?? 0),
    host_wait_seconds: experiment.hostBeforeRun?.waitSeconds,
    confirmation_seconds: log.final?.selectedArtifact === experiment.artifact ? log.final.workflow?.finalConfirmationSeconds : undefined,
    evidence: `.bench/research-20261005/${id}-${paired?.status === 'valid' ? (paired === final ? 'final' : 'compare') : 'screen'}.json` };
  if (paired?.status === 'valid') {
    row.baseline_gpu_mean_ms = avg(paired.pairs.map(p => p.baselineMs.gpuFrameMs));
    row.reduction_percent = paired.metrics.gpuFrameMs.pairedMeanReductionPercent;
  }
  if (!paired && screen?.status === 'valid' && typeof experiment.performanceReference === 'string' && experiment.performanceReference.endsWith('.json')) {
    const reference = await optional(resolve(ROOT, experiment.performanceReference));
    if (reference?.timing && screen.timing.cpuCombinedMs.mean > 1.5 * reference.timing.cpuCombinedMs.mean) {
      experiment.timingCaution = 'Screen synchronous CPU mean exceeded its reference by more than 50%; timing is sensitive to external host load. Raw native result remains preserved.';
      if (!quality?.passed) row.decision = 'Inconclusive with elevated CPU timing; not retained';
    }
  }
  experiment.measurements = row;
  rows.push(row);
}
const labels = { B00: 'Original repeatability', E01: 'Parallel GI rays', E02: 'Shared BVH stacks', E03: 'GI 8x4 groups', E04: 'Direct near-child traversal', E05: 'E03 + E04 combined' };
const retained = log.experiments.find(e => e.id === 'E05').status.startsWith('Retained');
const decisions = { B00: 'reference', E01: 'rejected: slower', E02: 'rejected: slower', E03: 'verified: 3 pairs; superseded', E04: 'screen only; combined in E05', E05: retained ? 'retained: 9 fresh pairs' : log.experiments.find(e => e.id === 'E05').status };
const table = rows.map(r => ({ ...r, change: labels[r.iteration] ?? log.experiments.find(e => e.id === r.iteration)?.label,
  artifact_prefix: r.artifact?.slice(0, 12), decision: decisions[r.iteration] ?? r.decision }));
const columns = ['iteration', 'change', 'artifact_prefix', 'phase', 'gpu_mean_ms', 'gpu_p95_ms', 'cpu_mean_ms', 'baseline_gpu_mean_ms', 'reduction_percent', 'min_ssim', 'quality_samples', 'elapsed_seconds', 'host_wait_seconds', 'confirmation_seconds', 'decision'];
const cell = (v, c) => v == null ? '' : (typeof v === 'number' ? (c === 'min_ssim' ? v.toFixed(12) : c.endsWith('_seconds') ? v.toFixed(2) : c === 'reduction_percent' ? v.toFixed(6) : c.endsWith('_ms') ? v.toFixed(6) : String(v)) : String(v)).replace(/[\t\r\n]+/g, ' ');
await writeFile(resolve(ROOT, 'AUTORESEARCH_RESULTS.tsv'), columns.join('\t')+'\n'+table.map(r => columns.map(c => cell(r[c], c)).join('\t')).join('\n')+'\n');
await writeFile(resolve(ROOT, 'PERFORMANCE_4K_ULTRA.json'), JSON.stringify(log, null, 2)+'\n');
console.log(`Updated ${table.length} iteration rows in AUTORESEARCH_RESULTS.tsv`);
console.log(columns.map(c => cell(table.at(-1)[c], c)).join('\t'));
