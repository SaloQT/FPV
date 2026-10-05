import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const bPath='src/render/shaders/rt/rt_bvh.wgsl', gPath='src/render/shaders/rt/gi.wgsl', pPath='src/render/rt/pipelines.ts', tPath='src/render/shaders/rt/test.wgsl';
const [b,g,p,t] = await Promise.all([read('.bench/research-20261005/overnight-e05-source/'+bPath), read(gPath), read(pPath), read(tPath)]);
const lanes = g.match(/@workgroup_size\(([^)]+)\)/)[1].split(',').reduce((n,s)=>n*Number(s.trim()),1);
if (!g.includes('@builtin(local_invocation_index) local : u32')) throw new Error('Expected local invocation index in selected GI shader');
const winner = JSON.parse(await read('.bench/research-20261005/overnight-kernels-winner.json'));
const helpers = `
#ifdef HYBRID_STACK
const PRIVATE_STACK_SIZE : u32 = \${PRIVATE_STACK}u;
const STACK_LANES : u32 = \${STACK_LANES}u;
var<private> stackLane : u32;
// Only the less frequently visited deep slots use LDS. Each invocation owns its
// column, so neither cross-lane communication nor a barrier is required.
var<workgroup> stackOverflow : array<vec2u, (32u - PRIVATE_STACK_SIZE) * STACK_LANES>;
#else
const PRIVATE_STACK_SIZE : u32 = 32u;
#endif

fn closestStore(stack : ptr<function, array<BvhStackEntry, PRIVATE_STACK_SIZE>>, slot : u32, value : BvhStackEntry) {
#ifdef HYBRID_STACK
  if (slot >= PRIVATE_STACK_SIZE) {
    stackOverflow[(slot-PRIVATE_STACK_SIZE)*STACK_LANES+stackLane] = vec2u(value.node, bitcast<u32>(value.entry));
    return;
  }
#endif
  (*stack)[slot] = value;
}
fn closestLoad(stack : ptr<function, array<BvhStackEntry, PRIVATE_STACK_SIZE>>, slot : u32) -> BvhStackEntry {
#ifdef HYBRID_STACK
  if (slot >= PRIVATE_STACK_SIZE) {
    let value = stackOverflow[(slot-PRIVATE_STACK_SIZE)*STACK_LANES+stackLane];
    return BvhStackEntry(value.x, bitcast<f32>(value.y));
  }
#endif
  return (*stack)[slot];
}
fn transmitStore(stack : ptr<function, array<u32, PRIVATE_STACK_SIZE>>, slot : u32, node : u32) {
#ifdef HYBRID_STACK
  if (slot >= PRIVATE_STACK_SIZE) {
    stackOverflow[(slot-PRIVATE_STACK_SIZE)*STACK_LANES+stackLane].x = node;
    return;
  }
#endif
  (*stack)[slot] = node;
}
fn transmitLoad(stack : ptr<function, array<u32, PRIVATE_STACK_SIZE>>, slot : u32) -> u32 {
#ifdef HYBRID_STACK
  if (slot >= PRIVATE_STACK_SIZE) { return stackOverflow[(slot-PRIVATE_STACK_SIZE)*STACK_LANES+stackLane].x; }
#endif
  return (*stack)[slot];
}
`;
const split=b.indexOf('fn traceBvhTransmit');
let closest=b.slice(0,split).replace('struct BvhStackEntry { node : u32, entry : f32 }', 'struct BvhStackEntry { node : u32, entry : f32 }\n'+helpers)
  .replace('array<BvhStackEntry, 32>', 'array<BvhStackEntry, PRIVATE_STACK_SIZE>')
  .replaceAll(/stack\[sp\] = (BvhStackEntry\([^;]+\));/g, 'closestStore(&stack, sp, $1);').replace('top = stack[sp];', 'top = closestLoad(&stack, sp);');
let transmit=b.slice(split).replace('array<u32, 32>', 'array<u32, PRIVATE_STACK_SIZE>')
  .replaceAll(/stack\[sp\] = ([^;]+);/g, 'transmitStore(&stack, sp, $1);').replace('n = stack[sp];', 'n = transmitLoad(&stack, sp);');
const variants=[16,8,4,1].map((size,i)=>({id:`E${29+i}`,label:`Hybrid BVH stack ${size} private`,
  hypothesis:`Keep the common first ${size} stack slots private and spill only deeper slots to per-lane workgroup memory, reducing register pressure while retaining the full 32-slot traversal and exact arithmetic`,
  files:{
    [bPath]:closest+transmit,
    [gPath]:g.replace('  let px = vec2i(gid.xy);','  stackLane = local;\n  let px = vec2i(gid.xy);'),
    [pPath]:p.replace('make(s, s, { GRP: 2 }, traceLayout)',`make(s, s, { GRP: 2, ...(s === 'gi' ? { HYBRID_STACK: true, PRIVATE_STACK: ${size}, STACK_LANES: ${lanes} } : {}) }, traceLayout)`)
      .replace("rc.module('rt/test.wgsl', { GRP: 2 })",`rc.module('rt/test.wgsl', { GRP: 2, HYBRID_STACK: true, PRIVATE_STACK: ${size}, STACK_LANES: 64 })`),
    [tPath]:t.replace('gid : vec3u) {','gid : vec3u, @builtin(local_invocation_index) local : u32) {\n  stackLane = local;'),
  }}));
await explore('overnight-hybrid',variants,resolve(evidence,winner.id==='E05'?'overnight-control-0.json':`${winner.id.toLowerCase()}-screen.json`),winner.id);
