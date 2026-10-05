import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const path='src/render/shaders/rt/atrous.wgsl', source=await read(path);
if(!source.includes('for (var j = -2; j <= 2; j++)')||!source.includes('for (var i = -2; i <= 2; i++)'))throw new Error('Expected original 5x5 filter stencil');
// Test diffuse GI first: it offers substantial filter work while leaving the
// primary shadow and specular stencils unchanged. Broader variants come last.
const variants=[['E119','GI only','GI'],['E120','last iteration','FINAL'],['E121','shadow only','SHADOW'],['E122','all signals',null]].map(([id,scope,define])=>{
 const radius=define?`#ifdef ${define}\nconst FILTER_RADIUS : i32 = 1;\n#else\nconst FILTER_RADIUS : i32 = 2;\n#endif\n`:'const FILTER_RADIUS : i32 = 1;\n';
 const shader=source.replace('const LUMA_FLOOR',radius+'\nconst LUMA_FLOOR')
   .replace('for (var j = -2; j <= 2; j++)','for (var j = -FILTER_RADIUS; j <= FILTER_RADIUS; j++)')
   .replace('for (var i = -2; i <= 2; i++)','for (var i = -FILTER_RADIUS; i <= FILTER_RADIUS; i++)');
 return {id,label:`3x3 bilateral stencil: ${scope}`,hypothesis:'Reduce filter texture fetches by retaining the original central 3x3 bilateral taps and normalization. This approximation can change softness or noise; reject unless ORIGINAL SSIM, existing byte bounds and final motion/detail review pass',files:{[path]:shader}};
});
const predecessor=process.argv[2]??'.bench/research-20261005/overnight-fused-visibility-winner.json';
const winner=JSON.parse(await read(predecessor));
await explore('overnight-filter-stencil',variants,resolve(evidence,`${winner.id.toLowerCase()}-screen.json`),winner.id);
