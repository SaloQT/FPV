import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from '../native-bench/common.mjs';
const path=resolve(ROOT,'PERFORMANCE_4K_ULTRA.json'), log=JSON.parse(await readFile(path,'utf8'));
for (const id of ['E42','E43','E44']) {
  log.experiments.find(e=>e.id===id).status='Inconclusive: unchanged E41 control exposed severe timing instability during external CPU build activity; not retained';
}
log.overnight={
  deadline:'2026-10-05T08:00:00+11:00',
  exploratoryMethod:'One fixed native screen, then two existing original-baseline image/state checks only for promising candidates. No extra GPU quality flight, paired comparisons or broad tests per exploratory iteration. Full confirmation reserved for finalist.',
  elapsedSecondsScope:'Automated immutable build through native screen and optional two-image evaluation; implementation/planning time is outside this value.',
  timingInstability:{control:'.bench/research-20261005/overnight-control-1.json',sameArtifactAs:'E41',
    initialGpuMeanMs:49.21578794666669,controlGpuMeanMs:85.89366613333327,controlCpuMeanMs:7.685097333333409,
    observation:'Other project C++ build jobs became active. RAM had approximately 41 GiB free; no persistent heavy GPU user was observed after the run. CPU contention is a plausible cause, not proven attribution.',
    decision:'Preserve all raw runs; do not use the slow control as a performance target. Require a stable fresh control before more GPU experiments.'}
};
await writeFile(path,JSON.stringify(log,null,2)+'\n');
