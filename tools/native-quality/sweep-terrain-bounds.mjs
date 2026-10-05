import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const tPath='src/render/terrainUpload.ts',wPath='src/render/worldBindings.ts',sPath='src/render/shaders/rt/rt_terrain.wgsl',cPath='src/render/contracts.ts';
const [t,w,s,c]=await Promise.all([tPath,wPath,sPath,cPath].map(read));
const first=Number(process.argv[2] ?? 70);
if(!Number.isInteger(first)||first<1)throw new Error('Invalid starting iteration ID');
const winner=JSON.parse(await read(process.argv[3] ?? '.bench/research-20261005/overnight-split-groups-winner.json'));
const exact=`
/** Precompute the tracer's original clamped 2x2 max at every mip. These are the
 * same conservative bounds as four shader fetches, with one fetch per node. */
export function buildTraceBoundsPyramid(height: Float32Array, n: number): Float32Array[] {
  return buildMaxPyramid(height, n).map((src, mip) => {
    const size = Math.max(1, n >> mip), dst = new Float32Array(src.length);
    for (let y = 0; y < size; y++) {
      const row = y * size, next = Math.min(y + 1, size - 1) * size;
      for (let x = 0; x < size; x++) {
        const nx = Math.min(x + 1, size - 1);
        dst[row + x] = Math.max(Math.max(src[row + x], src[row + nx]), Math.max(src[next + x], src[next + nx]));
      }
    }
    return dst;
  });
}
`;
const tight=`
/** Bounds over closed cell spans, including the shared outer vertex. */
export function buildTraceBoundsPyramid(height: Float32Array, n: number): Float32Array[] {
  const cells = new Float32Array(height.length);
  for (let y = 0; y < n; y++) {
    const row = y * n, next = Math.min(y + 1, n - 1) * n;
    for (let x = 0; x < n; x++) {
      const nx = Math.min(x + 1, n - 1);
      cells[row + x] = Math.max(Math.max(height[row + x], height[row + nx]), Math.max(height[next + x], height[next + nx]));
    }
  }
  return buildMaxPyramid(cells, n);
}
`;
const begin=s.indexOf('fn nodeMax('),end=s.indexOf('\n}',begin)+2;
if(begin<0||end<2)throw new Error('nodeMax not found');
const shader=s.slice(0,begin)+`fn nodeMax(c : vec2i, lvl : u32) -> f32 {
  let hi = vec2i((i32(frame.terrain.x) >> lvl) - 1);
  return textureLoad(terrainMaxPyr, min(c, hi), i32(lvl)).x;
}`+s.slice(end);
const upload=w.replaceAll('buildMaxPyramid','buildTraceBoundsPyramid');
const contract=c.replace('r32float, N x N with full mip chain: mip m = max over 2^m x 2^m texels','r32float, N x N with full mip chain of conservative closed-span terrain trace bounds');
const variants=[
  {id:`E${first}`,label:'Precompute identical terrain bounds',hypothesis:'Bake the same four-fetch maximum at each mip during terrain upload; remove three texture loads per visited terrain node without changing bounds or trace decisions',files:{[tPath]:t+exact,[wPath]:upload,[sPath]:shader,[cPath]:contract}},
  {id:`E${first+1}`,label:'Tighter closed-cell terrain bounds',hypothesis:'Build a maximum pyramid over closed cells to obtain tighter conservative terrain bounds with one fetch per node; preserve actual triangulated terrain and check against ORIGINAL',files:{[tPath]:t+tight,[wPath]:upload,[sPath]:shader,[cPath]:contract}},
  {id:`E${first+2}`,label:'Hoist terrain ray reciprocal',hypothesis:'Compute inverse ray-grid direction once outside the terrain walk, replacing repeated division in node boundary distances; compare floating-point output against ORIGINAL',files:{[sPath]:s.replace('  var t = tEnter;','  let invDg = 1.0 / safeDg;\n  var t = tEnter;').replace('(bnd - go) / safeDg','(bnd - go) * invDg')}},
];
await explore(process.argv[4] ?? 'overnight-terrain-bounds',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
