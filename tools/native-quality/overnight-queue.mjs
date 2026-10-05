// Run prepared batches in sequence. Every batch restores its best screened source
// and every native job still owns the existing machine-wide GPU lock.
import { open, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT } from '../native-bench/common.mjs';
const evidence=resolve(ROOT,'.bench/research-20261005');
const stages=[
  ['overnight-terrain-material','tools/native-quality/sweep-terrain-material.mjs'],
  ['overnight-parent-traversal','tools/native-quality/sweep-parent-traversal.mjs'],
  ['overnight-small-kernels','tools/native-quality/sweep-small-kernels.mjs'],
  ['overnight-terrain-retry','tools/native-quality/sweep-terrain-bounds.mjs','98','.bench/research-20261005/overnight-small-kernels-winner.json','overnight-terrain-retry'],
  ['overnight-packed-stacks','tools/native-quality/sweep-packed-stacks.mjs'],
  ['overnight-gi-serial','tools/native-quality/sweep-gi-serial.mjs'],
];
// This file is written only after the previous batch restores its winning source.
const predecessor=JSON.parse(await readFile(resolve(evidence,'overnight-gi-visibility-winner.json'),'utf8'));
if(!predecessor.artifact)throw new Error('Visibility batch must complete before the queue starts');
const status={startedAt:new Date().toISOString(),predecessor,completed:[],pending:stages.map(s=>s[0]),state:'running'};
const save=()=>writeFile(resolve(evidence,'overnight-queue-status.json'),JSON.stringify(status,null,2)+'\n');
await save();
for(const [name,...argv] of stages) {
  if(Date.now()>=Date.parse('2026-10-04T20:15:00Z')) {status.state='exploration cutoff reached';await save();break;}
  status.current=name;await save();
  const output=await open(resolve(evidence,`${name}.console.txt`),'wx');
  console.log(`Starting ${name}`);
  let code;
  try {
    code=await new Promise((accept,reject)=>{
      const child=spawn(process.execPath,argv,{cwd:ROOT,windowsHide:true,stdio:['ignore',output.fd,output.fd]});
      child.once('error',reject);child.once('close',accept);
    });
  } finally {await output.close();}
  if(code!==0) {
    try {status.lastWinner=JSON.parse(await readFile(resolve(evidence,`${name}-winner.json`),'utf8'));} catch {}
    status.state=`stopped: ${name} exit ${code}`;await save();process.exitCode=1;break;
  }
  status.completed.push(name);status.pending.shift();
  status.lastWinner=JSON.parse(await readFile(resolve(evidence,`${name}-winner.json`),'utf8'));
  await save();console.log(`Completed ${name}: ${status.lastWinner.id}`);
}
if(!status.pending.length)status.state='prepared batches completed';
delete status.current;status.finishedAt=new Date().toISOString();await save();
