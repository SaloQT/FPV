import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const path='src/render/shaders/rt/rt_bvh.wgsl',source=await read(path);
const winner=JSON.parse(await read('.bench/research-20261005/overnight-terrain-retry-winner.json'));
const variants=[];
const replaceStack=(helper,type)=>helper+'\n'+source.replaceAll('var stack : array<u32, 32>;',`var stack : ${type};`)
  .replace(/stack\[sp\] = ([^;]+);/g,'packedStackStore(&stack, sp, $1);').replaceAll('stack[sp]','packedStackLoad(&stack, sp)');
if(source.includes('var stack : array<u32, 32>;')) {
  for(const [id,bits] of [['E101',19],['E102',24]]) {
    const words=bits,mask=`0x${(2**bits-1).toString(16)}u`;
    const helper=`// SceneBuffers uses at most 128 + 2*MAX_PRIMS nodes, below 2^19.
// Pack all 32 logical stack entries without changing their values or capacity.
fn packedStackStore(stack : ptr<function, array<u32, ${words}>>, slot : u32, node : u32) {
  let bit = slot * ${bits}u;
  let word = bit >> 5u;
  let shift = bit & 31u;
  let mask = ${mask} << shift;
  (*stack)[word] = ((*stack)[word] & ~mask) | (node << shift);
  if (shift > ${32-bits}u) {
    let highBits = shift - ${32-bits}u;
    let highMask = (1u << highBits) - 1u;
    (*stack)[word + 1u] = ((*stack)[word + 1u] & ~highMask) | (node >> (32u - shift));
  }
}
fn packedStackLoad(stack : ptr<function, array<u32, ${words}>>, slot : u32) -> u32 {
  let bit = slot * ${bits}u;
  let word = bit >> 5u;
  let shift = bit & 31u;
  var node = (*stack)[word] >> shift;
  if (shift > ${32-bits}u) { node |= (*stack)[word + 1u] << (32u - shift); }
  return node & ${mask};
}
`;
    variants.push({id,label:`Pack BVH stack ${bits} bits`,hypothesis:'Reduce private scratch allocation and initialization by packing bounded node IDs; keep all 32 logical entries, exact node indices, visit order and overflow checks',files:{[path]:replaceStack(helper,`array<u32, ${words}>`)}});
  }
  const helper=`// Low 16 bits use two entries per word; upper bits occupy a four-bit
// nibble in a small vector. SceneBuffers node indices fit in 19 bits.
struct PackedNodeStack { low : array<u32, 16>, high : vec4u }
fn packedStackStore(stack : ptr<function, PackedNodeStack>, slot : u32, node : u32) {
  let word = slot >> 1u;
  let shift = (slot & 1u) * 16u;
  (*stack).low[word] = ((*stack).low[word] & ~(65535u << shift)) | ((node & 65535u) << shift);
  let highWord = slot >> 3u;
  let highShift = (slot & 7u) * 4u;
  (*stack).high[highWord] = ((*stack).high[highWord] & ~(15u << highShift)) | ((node >> 16u) << highShift);
}
fn packedStackLoad(stack : ptr<function, PackedNodeStack>, slot : u32) -> u32 {
  let low = ((*stack).low[slot >> 1u] >> ((slot & 1u) * 16u)) & 65535u;
  let high = ((*stack).high[slot >> 3u] >> ((slot & 7u) * 4u)) & 15u;
  return low | (high << 16u);
}
`;
  variants.push({id:'E103',label:'Split low/high BVH stack bits',hypothesis:'Halve the variable-index low-word array and keep upper node bits in a four-word vector; preserve full node IDs, stack capacity and traversal behavior',files:{[path]:replaceStack(helper,'PackedNodeStack')}});
} else console.log('Selected traversal has no private node stack; packed-stack experiments are unnecessary.');
await explore('overnight-packed-stacks',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
