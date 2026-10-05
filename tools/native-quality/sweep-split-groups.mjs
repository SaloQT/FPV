import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const gPath='src/render/shaders/rt/gi.wgsl',iPath='src/render/rt/index.ts';
const [g,i]=await Promise.all([gPath,iPath].map(read));
const winner=JSON.parse(await read('.bench/research-20261005/overnight-bvh-math-winner.json'));
const variants=[];
for (const [id,x,y] of [['E60',4,4],['E61',16,1],['E62',8,4],['E63',4,8],['E64',16,2],['E65',8,8]]) {
  const shader=g.replace('array<vec4f, 32>',`array<vec4f, ${x*y*2}>`)
    .replace('@workgroup_size(8, 2, 2)',`@workgroup_size(${x}, ${y}, 2)`)
    .replaceAll('local + 16u',`local + ${x*y}u`);
  const index=i.replace('this.traced(this.pipes.giShade, groups.giShade[par], Math.ceil(this.rc.gbuf.rtWidth / 8), Math.ceil(this.rc.gbuf.rtHeight / 2), 1);',
    `this.traced(this.pipes.giShade, groups.giShade[par], Math.ceil(this.rc.gbuf.rtWidth / ${x}), Math.ceil(this.rc.gbuf.rtHeight / ${y}), 1);`)
    .replace("sig === 'gi' ? Math.ceil(this.rc.gbuf.rtWidth / 8)",`sig === 'gi' ? Math.ceil(this.rc.gbuf.rtWidth / ${x})`)
    .replace("sig === 'gi' ? Math.ceil(this.rc.gbuf.rtHeight / 2)",`sig === 'gi' ? Math.ceil(this.rc.gbuf.rtHeight / ${y})`);
  variants.push({id,label:`Split GI shade ${x}x${y}x2`,hypothesis:'Retune workgroup shape and occupancy after separating GI hit tracing from shading; preserve both original rays and their reduction order',files:{[gPath]:shader,[iPath]:index}});
}
const start=g.indexOf('  let d0 = basis * cosineHemisphere(noise2(px, 1u));');
const end=g.indexOf('\n}',start);
if(start<0||end<0)throw new Error('Trace block missing');
const parallel=g.slice(0,start)+`  let ray = gid.z;
  let d = basis * cosineHemisphere(noise2(px, 1u + ray));
  let h = traceScene(origin, d, rp.f.w, rp.cfg.y);
  if (ray == 0u) { textureStore(out0, px, encodeGiHit(h)); }
  else { textureStore(out1, px, encodeGiHit(h)); }`+g.slice(end);
for(const [id,x,y] of [['E66',8,2],['E67',4,4],['E68',8,4],['E69',16,2]]) {
  const shader=parallel.replace('@workgroup_size(8, 4)',`@workgroup_size(${x}, ${y}, 2)`)
    .replace('textureStore(out0, px, vec4f(0.0)); textureStore(out1, px, vec4f(0.0)); return;',
      'if (gid.z == 0u) { textureStore(out0, px, vec4f(0.0)); } else { textureStore(out1, px, vec4f(0.0)); } return;');
  const index=i.replace('this.traced(this.pipes.giHits, groups.giHits[par], Math.ceil(this.rc.gbuf.rtWidth / 8), Math.ceil(this.rc.gbuf.rtHeight / 4), 1);',
    `this.traced(this.pipes.giHits, groups.giHits[par], Math.ceil(this.rc.gbuf.rtWidth / ${x}), Math.ceil(this.rc.gbuf.rtHeight / ${y}), 1);`);
  variants.push({id,label:`Split GI trace ${x}x${y}x2`,hypothesis:'Trace the same two GI hit records in independent lanes to shorten the serial trace kernel; leave the shading stage and ordered sum unchanged',files:{[gPath]:shader,[iPath]:index}});
}
await explore('overnight-split-groups',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
