import { readFile } from 'node:fs/promises';
import { loadTrainer, ROOT } from './bundle.mjs';
import { resolve } from 'node:path';
const send = data => new Promise((ok, fail) => process.send(data, e => e ? fail(e) : ok()));
process.once('message', async o => {
  try {
    const t = await loadTrainer();
    const w = t.buildTrainWorld({seed:o.seed, style:o.style, gateCount:o.gateCount, difficulty:o.difficulty, laps:o.laps});
    const geometry = t.worldGeometry(w, 0);
    const results = [];
    const track = {terrainSeed:w.terrain.seed ?? o.seed, quality:'low', track:w.track};
    const base = { settings:o, geometry, track, warnings:w.warnings ?? [], results };
    await send({status:'running', message:'Course ready. Evaluating saved checkpoints…', ...base});
    if (o.preview) { await send({status:'complete',message:'Course generated',...base}); process.disconnect(); return; }
    for (const file of o.brains) {
      const brain = t.parseBrain(await readFile(resolve(ROOT,'public/brains',file),'utf8'));
      const runs = [];
      for (let i=0;i<o.runs;i++) {
        runs.push(t.evaluateBrain(brain,w,{seconds:o.seconds,windSpeed:o.wind,seed:100+i}));
        await send({status:'running',message:`${brain.name}: run ${i+1}/${o.runs}`, ...base});
      }
      const lapTimes = runs.flatMap(r=>r.lapTimes);
      const mean = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : null;
      const completed = runs.filter(r=>Number.isFinite(r.finish));
      const notes = [];
      const crashes = runs.reduce((s,r)=>s+r.crashes,0), stalls = runs.reduce((s,r)=>s+r.stalls,0);
      if (crashes) notes.push('Collision recovery / obstacle clearance: crashes recorded. Inspect gate events for the locations.');
      if (stalls) notes.push('Gate approach / recovery: no-progress respawns recorded.');
      if (completed.length < runs.length) notes.push('Completion reliability needs attention before prioritising speed.');
      if (!lapTimes.length) notes.push('No completed laps: insufficient timing data to assess race pace.');
      if (!crashes && !stalls && completed.length === runs.length) notes.push('Completed cleanly. Compare gate segment times against faster brains for pace opportunities.');
      const segments = geometry.gates.map(g => {
        const events = runs.flatMap(r=>r.events).filter(e=>e.gate===g.index && ['gate','lap','finish'].includes(e.event));
        return {gate:g.index,kind:g.kind,feature:g.feature,samples:events.length,meanSeconds:mean(events.map(e=>e.segmentSeconds)),bestSeconds:events.length?Math.min(...events.map(e=>e.segmentSeconds)):null};
      });
      const unfinishedAt = runs.filter(r=>!Number.isFinite(r.finish)).map(r=>r.nextGate);
      if (unfinishedAt.length) notes.push(`Timed out approaching gate(s) ${unfinishedAt.map(g=>g+1).join(', ')} (display numbering). Try a longer limit to distinguish slow pace from inability to finish.`);
      results.push({segments,file,name:brain.name,training:brain.stats,completed:completed.length,attempts:runs.length,meanLap:mean(lapTimes),bestLap:lapTimes.length?Math.min(...lapTimes):null,meanFinish:mean(completed.map(r=>r.finish)),crashes,stalls,notes,runs});
    }
    for (const r of results) {
      const gaps = r.segments.filter(s=>s.meanSeconds!==null).map(s=>{
        const other = results.filter(b=>b!==r).map(b=>b.segments[s.gate]?.meanSeconds).filter(v=>v!=null);
        const fastestOther = other.length?Math.min(...other):null;
        return {...s,fastestOther,secondsBehind:fastestOther===null?null:s.meanSeconds-fastestOther};
      }).filter(s=>s.secondsBehind>0.1).sort((a,b)=>b.secondsBehind-a.secondsBehind).slice(0,3);
      r.paceOpportunities=gaps;
      if(gaps.length) r.notes.push(`Largest measured segment gaps: ${gaps.map(s=>`gate ${s.gate+1}${s.feature?` (${s.feature})`:''}: +${s.secondsBehind.toFixed(2)} s`).join('; ')}. Includes launch/recovery; inspect events before changing rewards.`);
    }
    results.sort((a,b)=>b.completed/b.attempts-a.completed/a.attempts || (a.meanLap??Infinity)-(b.meanLap??Infinity));
    await send({status:'complete',message:'Comparison complete',...base,limitations:['Means include completed laps only; compare completion and crashes alongside pace.','Still-air repetitions are deterministic and may repeat identical results; wind seeds are matched between brains.','Segment events include recovery time and the initial launch leg; these are observations, not proof of a training cause.','Only saved brain files are evaluated. Save a checkpoint first to test current training progress.']});
  } catch(e) { await send({status:'failed',error:e.stack ?? e.message}); }
  process.disconnect();
});



