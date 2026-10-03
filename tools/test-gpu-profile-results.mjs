// Validate the persisted native results independently of asynchronous execution.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const dir = resolve(process.argv[2]);
const read = tag => JSON.parse(readFileSync(resolve(dir, `${tag}-result.json`), 'utf8'));
const baseline = read('baseline');
const summary = { baseline: '352c33e02637e65b5cf232fb1b3e764ab6d1ce18', softwareWebGPU: true, hardwarePerformanceClaim: false, modes: [] };
for (const tag of ['normal', 'profile']) {
  const result = read(tag);
  assert.deepEqual(result.records, baseline.records);
  assert.deepEqual(result.errors, []); assert.equal(result.lost, null); assert.equal(result.validation, null);
  if (tag === 'normal') assert.deepEqual(result.commands, baseline.commands);
  const work = commands => commands.filter(c => c.kind !== 'computePass');
  assert.deepEqual(work(result.commands), work(baseline.commands));
  assert.equal(result.timings.length, 3);
  assert.deepEqual(result.timings.map(s => s.frameIndex).sort((a,b)=>a-b), [0,1,2]);
  assert.equal(new Set(result.timings.map(s => s.sequence)).size, 3);
  for (const s of result.timings) {
    assert.equal(s.status, 'measured');
    assert(Number.isFinite(s.gpuMs) && s.gpuMs >= 0);
    assert.equal(s.passMs.length, 6); assert(s.passMs.every(v => Number.isFinite(v) && v >= 0));
    if (tag === 'profile') {
      for (const key of ['rtAux', 'probes', 'shadowRays', 'shadowDenoise', 'giRays', 'giDenoise', 'specularRays', 'specularDenoise', 'rtLatch', 'clouds']) {
        assert(Number.isFinite(s.detailMs[key]) && s.detailMs[key] >= 0, `${key} written and resolved`);
      }
    } else assert.equal(s.detailMs, null);
  }
  summary.modes.push({ mode:tag, operations:result.records.length, exactImages:true, exactProbeAtlases:true, computeTraceEntries:result.commands.length, productionWorkOrderExact:true, defaultTraceExact:tag==='normal', uniquePresentedSamples:3,capturesExcluded:2,validation:null });
}
writeFileSync(resolve(dir,'summary.json'), JSON.stringify(summary,null,2));
console.log('PASS',JSON.stringify(summary));
