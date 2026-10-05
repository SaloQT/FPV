import { resolve } from 'node:path';
import { evidence, read, explore } from './explore.mjs';
const aPath = 'src/render/shaders/rt/atrous.wgsl', sPath = 'src/render/shaders/rt/rt_scene.wgsl', bPath = 'src/render/shaders/rt/rt_bvh.wgsl';
const [a,s,b] = await Promise.all([aPath,sPath,bPath].map(read));
const winner = JSON.parse(await read('.bench/research-20261005/overnight-rays-winner.json'));
const variants = [];
const add = (id, label, hypothesis, path, text) => variants.push({id, label, hypothesis, files: {[path]:text}});
add('E21', 'Combine filter exponentials', 'Evaluate the product of depth and luminance exponential stops as one exponential of their summed exponents, preserving the continuous filter formula', aPath,
  a.replace('let wz = exp(-abs(planeStop(pixelUv(rtSrc(q)), zq, planeA, planeR, near) - plane0) / zTol);',
    'let depthExponent = -abs(planeStop(pixelUv(rtSrc(q)), zq, planeA, planeR, near) - plane0) / zTol;')
    .replace('twj * wz * wn * exp(-abs(lc - tapLuma(s)) / sigmaL)', 'twj * wn * exp(depthExponent - abs(lc - tapLuma(s)) / sigmaL)'));
add('E22', 'One-divide filter plane', 'Multiply numerator and denominator of the plane projection by linear depth to remove the per-tap near/depth division; check rounding effects against original output', aPath,
  a.replace('  let d = near / linearZ;\n', '').replace('(dot(A.xy, ndc) + A.z * d + A.w) / (dot(R.xy, ndc) + R.z * d + R.w)',
    '((dot(A.xy, ndc) + A.w) * linearZ + A.z * near) / ((dot(R.xy, ndc) + R.w) * linearZ + R.z * near)'));
add('E23', 'Skip negligible depth taps', 'Skip filter taps whose depth stop is below 0.0001 before fetching colour and normal; negligible-contribution approximation must pass original-image similarity', aPath,
  a.replace('      let s = textureLoad(srcTex, q, 0);\n      let nq = octDecode(textureLoad(auxNormal, q, 0).xy);\n', '')
    .replace('      // dot^16', '      if (wz < 0.0001) { continue; }\n      let s = textureLoad(srcTex, q, 0);\n      let nq = octDecode(textureLoad(auxNormal, q, 0).xy);\n      // dot^16'));
for (const [id,range] of [['E24',128],['E25',64]]) add(id, `Secondary shadows ${range}m`,
  'Use the existing distant-hit shading approximation sooner for secondary radiance only; primary shadow rays and advertised settings stay unchanged; reject visible lighting loss', sPath,
  s.replace('NEAR_SHADOW_RANGE : f32 = 250.0', `NEAR_SHADOW_RANGE : f32 = ${range}.0`));
add('E26', 'Cull missed dynamic root', 'Box-test the small dynamic-tree root before testing its leaf primitives, preserving one root visit and the static traversal order', bPath,
  b.replaceAll('    let n0 = bvhNodes[n * 2u];', '    if (n == rp.scene.y && nodeEntry(n, o, inv, tMax) >= NO_HIT) { continue; }\n    let n0 = bvhNodes[n * 2u];'));
let nodeOnly = b.replace('var stack : array<BvhStackEntry, 32>;', 'var stack : array<u32, 32>;')
  .replace('stack[sp] = BvhStackEntry(rp.scene.y, 0.0)', 'stack[sp] = rp.scene.y')
  .replace('stack[sp] = BvhStackEntry(rp.scene.x, 0.0)', 'stack[sp] = rp.scene.x')
  .replace('top = stack[sp];', 'let popped = stack[sp];\n      var entry = 0.0;\n      if (popped != rp.scene.x && popped != rp.scene.y) { entry = nodeEntry(popped, o, inv, tMax); }\n      top = BvhStackEntry(popped, entry);')
  .replace('stack[sp] = BvhStackEntry(select(n0.w, n0.w + 1u, leftFirst), farT);', 'stack[sp] = select(n0.w, n0.w + 1u, leftFirst);');
add('E27', 'Recompute far-node entry', 'Halve closest-hit private stack storage by keeping only node indices and recomputing the same entry distance on far-node pop; preserve visits, pruning and traversal order', bPath, nodeOnly);
add('E28', 'Early opaque canopy exit', 'Canopy optical depth is nonnegative; return opaque immediately when accumulation crosses the existing threshold instead of finishing the leaf', bPath,
  b.replace('tau += canopyOpticalDepth(i, o, d, tMax);', 'tau += canopyOpticalDepth(i, o, d, tMax);\n          if (tau > CANOPY_OPAQUE_TAU) { return 0.0; }'));
await explore('overnight-kernels', variants, resolve(evidence, winner.id === 'E05' ? 'overnight-control-0.json' : `${winner.id.toLowerCase()}-screen.json`), winner.id);
