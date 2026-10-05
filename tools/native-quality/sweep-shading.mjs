import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const gPath='src/render/shaders/rt/gi.wgsl',sPath='src/render/shaders/rt/rt_scene.wgsl',cPath='src/render/shaders/rt/rt_canopy.wgsl',cpuPath='src/render/rt/canopy.ts';
const [g,s,c,cpu] = await Promise.all([gPath,sPath,cPath,cpuPath].map(read));
const winner=JSON.parse(await read('.bench/research-20261005/overnight-gi-split-winner.json'));
if (!g.includes('#ifdef SHADE_ONLY')) throw new Error('This sweep requires the split GI candidate');
const variants=[],add=(id,label,hypothesis,files)=>variants.push({id,label,hypothesis,files});
const two=g.replace('  let rays = rp.cfg.z;', '#ifdef SHADE_ONLY\n  let rays = 2u; // The CPU selects this pipeline only for the two-ray configuration.\n#else\n  let rays = rp.cfg.z;\n#endif');
add('E45','Specialize two-ray shade','Specialize the split shading pipeline to its guaranteed two-ray setting, retaining the dynamic fallback pipeline for all other ray counts',{[gPath]:two});
const loopStart=two.indexOf('  for (var r = start; r < end; r++) {'),brace=two.indexOf('{',loopStart);
if(loopStart<0)throw new Error('Expected GI per-ray loop');
let level=1,end=brace+1; for(;level&&end<two.length;end++){if(two[end]==='{')level++;else if(two[end]==='}')level--;}
const loop=two.slice(loopStart,end),body=two.slice(brace+1,end-1);
const once=two.slice(0,loopStart)+'#ifdef SHADE_ONLY\n  { let r = gid.z;'+body+'  }\n#else\n'+loop+'\n#endif'+two.slice(end);
add('E46','One shade operation per lane','Each split shading lane owns exactly one recorded ray; remove its dynamic loop while preserving the two-ray ordered reduction and other-quality fallback',{[gPath]:once});
add('E47','Skip unused hit stores','Sky and probe-only pixels never read hit records in the shade pass; avoid clearing those temporary records while retaining every final output write',{
  [gPath]:g.replace('    textureStore(out0, px, vec4f(0.0)); textureStore(out1, px, vec4f(0.0)); return;', '    return; // Shade does not read hit records for this pixel.')});
const sceneStart=s.indexOf('fn traceScene('),sceneEnd=s.indexOf('// Fraction of the key light',sceneStart);
const terrainFirst=`fn traceScene(o : vec3f, d : vec3f, tMax : f32, steps : u32) -> SceneHit {
  var h = SceneHit(tMax, KIND_MISS, 0u);
  if (hasTerrain()) {
    let tt = traceTerrain(o, d, tMax, steps);
    if (tt >= 0.0) { h = SceneHit(tt, KIND_TERRAIN, 0u); }
  }
  let b = traceBvh(o, d, h.t, bvhCap(steps));
  if (b.prim != NO_NODE) { h = SceneHit(b.t, KIND_PRIM, b.prim); }
  return h;
}

`;
add('E48','Terrain-first scene trace','Find the terrain bound before BVH tracing so nearby terrain can prune distant primitives; retain terrain tie priority, scene contents and budgets',{[sPath]:s.slice(0,sceneStart)+terrainFirst+s.slice(sceneEnd)});
add('E49','Terrain-first visibility','For shadow visibility test opaque terrain first and only traverse primitives when the terrain is clear; preserve the same product of visibility terms',{
  [sPath]:s.replace('  let v = traceBvhTransmit(o, d, tMax, bvhCap(steps) * 2u);\n  if (v > 0.0 && hasTerrain() && traceTerrain(o, d, tMax, steps) >= 0.0) { return 0.0; }\n  return v;',
    '  if (hasTerrain() && traceTerrain(o, d, tMax, steps) >= 0.0) { return 0.0; }\n  return traceBvhTransmit(o, d, tMax, bvhCap(steps) * 2u);')});
for(const[id,count]of[['E50',3],['E51',2]])add(id,`Canopy quadrature ${count} points`,
  'Approximate the same canopy optical-depth integral with fewer stratified quadrature points; keep ray counts, geometry and simulation unchanged; reject similarity or temporal artifacts',{
    [cPath]:c.replace('CANOPY_SAMPLES : u32 = 4u',`CANOPY_SAMPLES : u32 = ${count}u`),
    [cpuPath]:cpu.replace('export const CANOPY_SAMPLES = 4;',`export const CANOPY_SAMPLES = ${count};`)});
for(const[id,range]of[['E52',32],['E53',64]])add(id,`Split GI secondary shadows ${range}m`,
  'Apply the existing distant secondary-hit lighting approximation sooner within the split GI renderer; preserve primary shadows and validate original output',{
    [sPath]:s.replace('NEAR_SHADOW_RANGE : f32 = 250.0',`NEAR_SHADOW_RANGE : f32 = ${range}.0`)});
// The unstable control-1 run is deliberately NOT a performance reference.
const reference=process.argv[2]??resolve(evidence,`${winner.id.toLowerCase()}-screen.json`);
await explore('overnight-shading',variants,resolve(reference),winner.id);
