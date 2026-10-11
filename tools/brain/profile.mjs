// Per-kernel GPU diagnostics. Trains in memory only; never writes a brain checkpoint.
// node tools/brain/profile.mjs --resume public/brains/ultimate.json --worlds 96 --seed 7 --warmup 5 --iters 20 --out .bench/brain/gpu-profile.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gpuDevice, loadTrainer, ROOT } from './bundle.mjs';

const argv = process.argv.slice(2);
const allowed = new Set(['resume','worlds','styles','recipes','seed','envs','steps','warmup','iters','out','lr','track']);
const args = {};
for (let i=0;i<argv.length;i+=2) {
  const key=argv[i]?.replace(/^--/,'');
  if (!argv[i]?.startsWith('--') || !allowed.has(key) || argv[i+1]===undefined || argv[i+1].startsWith('--')) throw Error(`Invalid option ${argv[i]}`);
  args[key]=argv[i+1];
}
const integer = (k,d,min=1) => {const n=args[k]===undefined?d:Number(args[k]);if(!Number.isInteger(n)||n<min)throw Error(`--${k} must be an integer >= ${min}`);return n;};
const warmup=integer('warmup',5), iters=integer('iters',20), seed=integer('seed',7,0);
const cfgOptions={envs:integer('envs',16384),steps:integer('steps',32),seed,profile:true,traceEnvs:0};
const worldCount=integer('worlds',48,0);
if(!worldCount && !args.track)throw Error('Choose generated worlds or --track');
const lr=args.lr===undefined?3e-4:Number(args.lr);if(!Number.isFinite(lr)||lr<0)throw Error('--lr must be nonnegative');
const output=resolve(ROOT,args.out??'.bench/brain/gpu-profile.json');
const category = name => name==='env-step'?'Environment physics + rewards'
  : name.startsWith('roll-')?'Rollout inference'
  : name==='sample'?'Action sampling'
  : name.startsWith('boot-')?'Bootstrap inference'
  : name==='gae'?'Advantages (GAE)'
  : name.endsWith('stats')?'Statistics'
  : name==='gather'?'Minibatch gather'
  : name.startsWith('mb-')?'Update inference'
  : name.startsWith('loss')?'PPO loss'
  : /^(dW|dX|reduce)/.test(name)?'Backpropagation'
  : /^(norm|adam)/.test(name)?'Gradient clipping + Adam':name;
let device;
try {
  const t=await loadTrainer();
  const gpu=await gpuDevice(undefined,{profile:true});device=gpu.device;
  const info=gpu.adapter.info;
  const provenance={backend:gpu.backend,adapter:gpu.name,adapterInfo:{vendor:info?.vendor,architecture:info?.architecture,device:info?.device,description:info?.description},timestampQuery:device.features.has('timestamp-query'),node:process.version};
  if(!provenance.timestampQuery) {
    await mkdir(dirname(output),{recursive:true});
    await writeFile(output,JSON.stringify({mode:'unsupported',provenance,error:'Adapter does not support timestamp-query'},null,2));
    throw Error(`GPU timestamp queries unsupported; report written to ${output}`);
  }
  console.log(`${gpu.backend}: ${gpu.name}; per-dispatch GPU timestamps enabled`);
  const cfg={...t.DEFAULT_PPO,...cfgOptions,lr,lrEnd:lr};
  t.PpoTrainer.check(cfg);
  const specs=t.trainWorldSpecs({worlds:worldCount,seed,styles:args.styles?t.parseStyles(args.styles):undefined,recipes:args.recipes===undefined?undefined:integer('recipes',0,0)});
  const worlds=specs.map(s=>t.buildMixWorld(s));
  for(const f of (args.track??'').split(',').filter(Boolean))worlds.push(t.trackFileWorld(await readFile(resolve(ROOT,f),'utf8')));
  const brain=args.resume?t.parseBrain(await readFile(resolve(ROOT,args.resume),'utf8')):undefined;
  console.log(`Building trainer: ${worlds.length} worlds, ${cfg.envs} drones, ${cfg.steps} steps; ${warmup} warmup + ${iters} measured iterations`);
  const trainer=await t.PpoTrainer.create(device,worlds,cfg,t.DEFAULT_ENV,brain);
  const samples=[];
  for(let i=0;i<warmup+iters;i++) {
    const start=performance.now(),m=await trainer.iterate(),wallMs=performance.now()-start;
    if(!Number.isFinite(m.policyLoss)||!Number.isFinite(m.valueLoss))throw Error('Training loss diverged during profiling');
    if(i>=warmup)samples.push({iteration:m.iteration,wallMs,submitToReadbackMs:m.gpuMs,profile:m.kernelProfile});
    console.log(`${i<warmup?'warmup':'measured'} ${i+1}/${warmup+iters}: kernel sum ${m.kernelProfile?.totalMs?.toFixed(3)} ms, compute span ${m.kernelProfile?.spanMs?.toFixed(3)} ms, wall ${wallMs.toFixed(1)} ms`);
  }
  const grouped=new Map();
  for(const sample of samples)for(const k of sample.profile.kernels) {
    let r=grouped.get(k.name);if(!r){r={name:k.name,category:category(k.name),ms:[],dispatches:0,validSamples:0,invalidSamples:0,zeroSamples:0};grouped.set(k.name,r);}
    if(k.totalMs!==null)r.ms.push(k.totalMs);
    for(const key of ['dispatches','validSamples','invalidSamples','zeroSamples'])r[key]+=k[key];
  }
  const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
  const kernels=[...grouped.values()].map(r=>({name:r.name,category:r.category,measuredIterations:r.ms.length,meanMsPerIteration:mean(r.ms),minMs:r.ms.length?Math.min(...r.ms):null,maxMs:r.ms.length?Math.max(...r.ms):null,avgUsPerDispatch:r.validSamples?r.ms.reduce((s,x)=>s+x,0)*1000/r.validSamples:null,dispatches:r.dispatches,validSamples:r.validSamples,invalidSamples:r.invalidSamples,zeroSamples:r.zeroSamples})).sort((a,b)=>(b.meanMsPerIteration??0)-(a.meanMsPerIteration??0));
  const categories={};for(const k of kernels)categories[k.category]=(categories[k.category]??0)+(k.meanMsPerIteration??0);
  const report={schemaVersion:1,mode:'timestamp',createdAt:new Date().toISOString(),provenance,config:cfg,env:t.DEFAULT_ENV,resume:args.resume??null,brain:brain?{name:brain.name,hidden:brain.hidden,stats:brain.stats}:null,worlds:worlds.map((w,i)=>({description:t.describeWorld(w,i),terrainSeed:w.terrain.seed,seed:w.seed,style:w.style})),warmup,measuredIterations:iters,meanKernelMs:mean(samples.map(s=>s.profile.totalMs).filter(x=>x!==null)),meanComputeSpanMs:mean(samples.map(s=>s.profile.spanMs).filter(x=>x!==null)),meanWallMs:mean(samples.map(s=>s.wallMs)),categories,kernels,samples,limitations:['One compute pass per dispatch adds overhead; compare normal training throughput with profiling off.','Kernel sum excludes gaps between passes, buffer copies, queue waits and CPU/readback work. Compute span includes gaps between the first and last dispatch.','Zero-duration samples may reflect timestamp quantisation; invalid samples are counted, not filled with zero.','Warmup iterations (including environment initialisation) are excluded. Networks update in memory during profiling; no brain files are saved.']};
  await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
  console.log('\nGPU categories (mean ms/iteration)');console.table(Object.entries(categories).sort((a,b)=>b[1]-a[1]).map(([name,ms])=>({category:name,ms:ms.toFixed(3)})));
  console.log('GPU kernels (mean ms/iteration)');console.table(kernels.map(k=>({kernel:k.name,ms:k.meanMsPerIteration?.toFixed(3)??'invalid','us/dispatch':k.avgUsPerDispatch?.toFixed(2)??'invalid',invalid:k.invalidSamples,zero:k.zeroSamples})));
  console.log(`Report: ${output}`);
  if(kernels.some(k=>k.invalidSamples) || !kernels.length)throw Error('Invalid timestamp samples detected; inspect report');
} catch(e) {console.error(e.stack??e);process.exitCode=1;}
finally {device?.destroy();}
process.exit(process.exitCode??0);

