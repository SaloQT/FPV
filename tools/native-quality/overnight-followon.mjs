// Wait for the already-running queue to restore its final source, then continue
// the prepared experiments without a manual handoff or overlapping GPU work.
import { open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../native-bench/common.mjs';
const evidence=resolve(ROOT,'.bench/research-20261005');
const status={startedAt:new Date().toISOString(),state:'waiting for primary queue',completed:[]};
const save=()=>writeFile(resolve(evidence,'overnight-followon-status.json'),JSON.stringify(status,null,2)+'\n');
await save();
let primary;
for (;;) {
  try { primary=JSON.parse(await readFile(resolve(evidence,'overnight-queue-status.json'),'utf8')); } catch (e) { if(e.code!=='ENOENT' && !(e instanceof SyntaxError))throw e; }
  if(primary?.finishedAt)break;
  if(Date.now()>=Date.parse('2026-10-04T20:15:00Z')) {status.state='exploration cutoff reached before handoff';await save();process.exit(0);}
  await new Promise(accept=>setTimeout(accept,5000));
}
if(primary.state!=='prepared batches completed') {status.state='primary queue stopped; inspect before continuing';status.primary=primary;await save();process.exit(1);}
status.state='running';status.predecessor=primary.lastWinner;await save();
for(const [name,script] of [['overnight-fused-visibility','sweep-fused-visibility.mjs'],['overnight-filter-stencil','sweep-filter-stencil.mjs']]) {
  if(Date.now()>=Date.parse('2026-10-04T20:15:00Z')) {status.state='exploration cutoff reached';break;}
  status.current=name;await save();console.log(`Starting ${name}`);
  const output=await open(resolve(evidence,`${name}.console.txt`),'wx');
  let code;
  try {code=await new Promise((accept,reject)=>{
    const child=spawn(process.execPath,[`tools/native-quality/${script}`],{cwd:ROOT,windowsHide:true,stdio:['ignore',output.fd,output.fd]});
    child.once('error',reject);child.once('close',accept);
  });} finally {await output.close();}
  try {status.lastWinner=JSON.parse(await readFile(resolve(evidence,`${name}-winner.json`),'utf8'));} catch {}
  if(code!==0) {status.state=`stopped: ${name} exit ${code}`;process.exitCode=1;break;}
  status.completed.push(name);await save();console.log(`Completed ${name}: ${status.lastWinner.id}`);
}
if(status.completed.length===2)status.state='prepared batches completed';
delete status.current;status.finishedAt=new Date().toISOString();await save();
