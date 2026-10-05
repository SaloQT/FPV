import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const pPath='src/render/shaders/rt/rt_prims.wgsl',cPath='src/render/shaders/rt/rt_canopy.wgsl',packPath='src/render/rt/prims.ts',aPath='src/render/shaders/rt/atrous.wgsl',sPath='src/render/shaders/rt/rt_scene.wgsl';
const [p,c,pack,a,s]=await Promise.all([pPath,cPath,packPath,aPath,sPath].map(read));
const winner=JSON.parse(await read('.bench/research-20261005/overnight-parent-traversal-winner.json'));
const variants=[],add=(id,label,hypothesis,files)=>variants.push({id,label,hypothesis,files});
add('E90','Canopy header flag after GI split','Retry the flag-layout optimization after pipeline decomposition: duplicate canopy classification in the primitive header to avoid a material-word load during transmission',{
  [packPath]:pack.replace('  u[o + 15] = isCanopyProxy(p) ? PRIM_FLAG_CANOPY : 0;', '  u[o + 15] = isCanopyProxy(p) ? PRIM_FLAG_CANOPY : 0;\n  u[o + 3] |= u[o + 15] << 8;'),
  [pPath]:p.replaceAll('switch (head.w)', 'switch (head.w & 255u)'),
  [cPath]:c.replace('(primWord(i, 3u).w & PRIM_FLAG_CANOPY)', '((primWord(i, 0u).w >> 8u) & PRIM_FLAG_CANOPY)')});
const hot=p.replace(`  switch (head.w) {
    case KIND_SPHERE: { return hitSphere(a.xyz, b.w, o, d, tMax); }`,
`  if (head.w == KIND_SPHERE) { return hitSphere(a.xyz, b.w, o, d, tMax); }
  switch (head.w) {`);
add('E91','Sphere intersection fast branch','Place the common sphere intersection in an explicit early-return branch before the general primitive switch, preserving the exact intersection equations',{[pPath]:hot});
const start=c.indexOf('  for (var k = 0u; k < CANOPY_SAMPLES; k++) {'),end=c.indexOf('\n  }\n  return tau',start);
if(start<0||end<0||!c.includes('CANOPY_SAMPLES : u32 = 4u'))throw new Error('Original four-sample canopy loop missing');
const body=c.slice(c.indexOf('\n',start)+1,end);
const unrolled=Array.from({length:4},(_,k)=>`  { let k = ${k}u;\n${body}\n  }`).join('\n');
add('E92','Unroll four canopy samples','Expose the four unchanged canopy quadrature samples as straight-line blocks, keeping jitter, sample locations and accumulation order',{[cPath]:c.slice(0,start)+unrolled+c.slice(end+4)});
for(const [id,threshold] of [['E93','0.0'],['E94','0.0001']]) {
  const shader=a.replace('      let s = textureLoad(srcTex, q, 0);\n      let nq = octDecode(textureLoad(auxNormal, q, 0).xy);\n', '')
    .replace('      // dot^16',`      if (wz <= ${threshold}) { continue; }\n      let s = textureLoad(srcTex, q, 0);\n      let nq = octDecode(textureLoad(auxNormal, q, 0).xy);\n      // dot^16`);
  add(id,threshold==='0.0'?'Skip exactly zero depth taps':'Skip negligible depth taps after GI split',threshold==='0.0'?
    'Avoid fetching colour and normals when the computed depth weight is exactly zero; preserve every nonzero tap':
    'Retry the previously near-identical filter approximation on the new pipeline: skip depth weights at most 0.0001 and compare only against ORIGINAL',{[aPath]:shader});
}
const centre=`      if (i == 0 && j == 0) {
        let nd = max(dot(n, n), 0.0);
        let nd2 = nd * nd;
        let wn = nd2 * nd2 * nd2 * nd2;
        let w = tapWeight(i) * twj * wn;
#ifdef SHADOW
        sum += centre.x * w;
#else
        sum += centre * w;
#endif
        wSum += w;
        continue;
      }
`;
add('E95','Reuse filter centre data','Reuse centre colour, normal and known zero depth/luma differences for the centre tap, at its original accumulation position; retain the computed normal self-dot for rounding consistency',{
  [aPath]:a.replace('      let q = px + vec2i(i, j) * stepPx;',centre+'      let q = px + vec2i(i, j) * stepPx;')});
for(const [id,range] of [['E96',64],['E97',128]])add(id,`Secondary GI shadows ${range}m after split`,
  'Use the existing distant-hit secondary shading approximation sooner while retaining primary shadows, all GI rays and advertised settings; assess against ORIGINAL for visible lighting loss',{
  [sPath]:s.replace('NEAR_SHADOW_RANGE : f32 = 250.0',`NEAR_SHADOW_RANGE : f32 = ${range}.0`)});
await explore('overnight-small-kernels',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
