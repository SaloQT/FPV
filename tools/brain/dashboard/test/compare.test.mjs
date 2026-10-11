import test from 'node:test';
import assert from 'node:assert/strict';
import { startDashboard } from '../../dashServer.mjs';
test('comparison endpoints list saved brains and reject unsafe requests', async()=>{
 const d=await startDashboard({port:0,outDir:null,log:()=>{}});
 const base=`http://127.0.0.1:${d.port}`;
 try {
  const names=await (await fetch(base+'/api/compare/brains')).json();assert.ok(names.includes('steady.json'));assert.ok(!names.includes('index.json'));
  const o={style:'race',seed:900001,gateCount:12,difficulty:0.5,laps:3,runs:1,seconds:10,wind:0,brains:['../steady.json']};
  let r=await fetch(base+'/api/compare',{method:'POST',body:JSON.stringify(o)});assert.equal(r.status,400);
  r=await fetch(base+'/api/compare',{method:'POST',headers:{Origin:'https://other.example'},body:JSON.stringify(o)});assert.equal(r.status,403);
  o.brains=['steady.json'];o.runs=100;r=await fetch(base+'/api/compare',{method:'POST',body:JSON.stringify(o)});assert.equal(r.status,400);
 } finally {await d.close();}
});

test('finished training keeps dashboard and comparisons available', async()=>{
 const d=await startDashboard({port:0,outDir:null,log:()=>{},onCommand:()=>{}});
 const base=`http://127.0.0.1:${d.port}`;
 try {
  d.push({iteration:1,elapsed:1,envSteps:1,sps:1,metrics:{},trace:{K:16,T:1,data:new Float32Array(64)}});
  await d.finish();await d.finish();
  const meta=await (await fetch(base+'/api/meta')).json();assert.equal(meta.status,'finished');assert.equal(meta.iterations,1);
  assert.equal((await fetch(base+'/api/trace/1')).status,200);
  assert.equal((await fetch(base+'/api/compare/brains')).status,200);
  const r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cmd:'stop'})});assert.equal(r.status,409);
 } finally {await d.close();}
});
