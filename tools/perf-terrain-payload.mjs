#!/usr/bin/env node
/** Reproducible CPU-only A/B: original per-frame packing vs exact retained payload.
 * node tools/perf-terrain-payload.mjs [output.json] (Node >=24). Includes build/frustum every frame.
 * Both arms use CURRENT WaterMask; this isolates packing cache, not full release-to-release performance.
 * Use perf-terrain-compare.mjs for actual baseline/candidate pipeline comparisons.
 * Does not time WebGPU uploads or claim an FPS improvement.
 */
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { extname, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
if (git('status', '--porcelain')) throw new Error('Benchmark requires a clean source tree');
const metadata = { optimizedCommit: git('rev-parse', 'HEAD'), node: process.version,
  packingReferenceCommit: '8f2e342c60370151af45840569678d21aadfbd78', baselineMethod: 'Frozen original index.ts copyTile/collectWater/waterQuads loops',
  timestamp: new Date().toISOString() };
console.log('Terrain payload benchmark', metadata);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !extname(specifier)) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform', sourceUrl: url }) };
    return next(url, context);
  },
});
const { Clipmap, Frustum, MAX_TILES, TILE_FLOATS } = await import('../src/render/terrain/clipmap.ts');
const { WaterMask } = await import('../src/render/terrain/waterMask.ts');
const { TilePayload } = await import('../src/render/terrain/tilePayload.ts');
const n = 1024, origin = -1024;
const heights = Float32Array.from({ length: n*n }, (_, i) => 50 + 40 * Math.sin((i%n)/120) * Math.cos(Math.floor(i/n)/120));
heights[0] = 0;
const mask = new WaterMask(heights,n,2,[origin,origin],0,90,1);
const dry = new WaterMask(heights,n,2,[origin,origin],0,90,-1);
function run(mode, cached, frames, waterMask) {
  const clip = new Clipmap(), frustum = new Frustum(), payload = new TilePayload(clip.tiles);
  const data = new Float32Array(2*MAX_TILES*TILE_FLOATS);
  const pos = [0,70,0], quat = [0,0,0,1];
  let uploads = 0, checksum = 0;
  const start = performance.now();
  for (let i=0;i<frames;i++) {
    const x = mode === 'stable' ? 0 : mode === 'slow' ? Math.sin(i*.001)*10 : mode === 'moving' ? i*.12 : mode === 'boundary' ? 2+(i%2 ? 1e-4 : -1e-4) : Math.sin(i*1.79)*6000;
    pos[0] = x;
    const yaw = mode === 'adversarial' ? i*.33 : mode === 'moving' ? i*.0003 : 0;
    quat[1] = Math.sin(yaw/2); quat[3] = Math.cos(yaw/2);
    frustum.setFromCamera(pos,quat,1.8,16/9);
    const count = clip.build(x,0,origin,origin,2,7,0,90,frustum);
    if (cached) {
      if (payload.update(count,origin,origin,waterMask)) uploads++;
      checksum += payload.waterCount + payload.waterQuads;
    } else {
      const tiles=clip.tiles;
      const copy=(dst,src)=>{for(let k=0;k<TILE_FLOATS;k++)data[dst*TILE_FLOATS+k]=tiles[src*TILE_FLOATS+k];};
      for(let j=0;j<count;j++)copy(j,j);
      let water=0;
      if(waterMask.enabled)for(let j=0;j<count;j++){
        const o=j*TILE_FLOATS,s=tiles[o+4],x0=origin+tiles[o]*s,z0=origin+tiles[o+1]*s;
        if(waterMask.regionBelow(x0,z0,x0+tiles[o+2]*s,z0+tiles[o+3]*s))copy(count+water++,j);
      }
      let quads=0;for(let j=0;j<water;j++)quads+=data[(count+j)*TILE_FLOATS+2]*data[(count+j)*TILE_FLOATS+3];
      checksum += water+quads; uploads++;
    }
  }
  return { usPerFrame:(performance.now()-start)*1000/frames, uploads, checksum };
}
const result={ metadata, frames:6000, samples:[], note:'CPU build/frustum/packing only; no GPU upload timing or FPS claims' };
for(const water of ['sparse','dry'])for(const mode of ['stable','slow','moving','boundary','adversarial']){
  const m=water==='dry'?dry:mask;
  run(mode,false,2000,m);run(mode,true,2000,m);
  const before=[],after=[];
  for(let r=0;r<5;r++){
    const a=r%2?run(mode,true,result.frames,m):run(mode,false,result.frames,m);
    const b=r%2?run(mode,false,result.frames,m):run(mode,true,result.frames,m);
    before.push(r%2?b:a);after.push(r%2?a:b);
    if(a.checksum!==b.checksum)throw new Error('Differential checksum mismatch');
  }
  const median=a=>a.map(x=>x.usPerFrame).sort((a,b)=>a-b)[2];
  const item={water,mode,before,after,beforeMedianUs:median(before),afterMedianUs:median(after)};
  result.samples.push(item);console.log(water,mode,item.beforeMedianUs,item.afterMedianUs,after[0].uploads);
}
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(result,null,2)+'\n');
