# Render core

WebGPU deferred renderer. `Renderer` (renderer.ts) owns the device, the frame graph, the G-buffer, the world bindings (group 1),
frame uniforms (group 0), the RT proxy registry, dynamic resolution and auto-exposure. Feature work lives in `RenderModule`s
(atmosphere, terrain, vegetation, objects, rt) plus one `PostProcessor` (post/).

## Frame graph (frameGraph.ts)

Per frame, in this order (modules run in `createDefaultModules()` array order inside each step):

1. `update(rc, f)` CPU work, buffer writes.  2. `encodePre(enc, rc, f)` compute before the G-buffer (LUTs, culling).
3. G-buffer render pass: `encodeGBuffer(pass, rc, f)` (4 MRT + depth).  4. `encodeRT(enc, rc, f)` compute writing `gbuf.sunShadow`,
`gbuf.giDiffuse`, `gbuf.giSpecular`.  5. Deferred lighting compute (lighting.ts, writes `gbuf.hdr` for every pixel).
6. `encodeSky(pass, rc, f)` (depth `equal` to 0, sky pixels only).  7. `encodeForward(pass, rc, f)` (depth-tested, no depth write).
8. `PostProcessor.encode` reads `hdr`, writes the swapchain.

`init` may be async. `resize(rc)` is called when the G-buffer is recreated (window resize, dynamic scale step, quality change): recreate
every bind group that references `rc.gbuf`. Never cache `rc.world.group`, `rc.gbuf` or `rc.quality` across frames.

## Bind groups

- `@group(0)` frame uniform (`shaders/common/frame.wgsl`, 768 B). `@group(1)` world (`world_bindings.wgsl`: samplers, terrain height/
  max-pyramid/normal/maps, transmittance, multi-scatter, sky-view, aerial-perspective, blue noise). `@group(2)` is yours.
- Render-pass hooks (`encodeGBuffer/Sky/Forward`) get groups 0 and 1 already bound. Compute hooks (`encodePre/RT`) must call
  `setBindGroup(0, rc.frame.group)` and `setBindGroup(1, rc.world.group)` themselves. Pipeline layouts:
  `[rc.frame.layout, rc.world.layout, myLayout]`.
- Conventions: +Y up, +X east, -Z north, metres. Depth is reverse-Z with an infinite far plane (near = 1, far = 0, clear 0).

## Units and exposure

Lights are physical: `frame.sunIrradiance` is top-of-atmosphere lux (127000), multiply by `sampleTransmittance(r, sunDir.y)`; sky LUT
is in nits. Every value written to an HDR-domain target is multiplied by pre-exposure `frame.params.y`. `frame.misc.w` is the key-light
flag (0 = sun shadow texture, 1 = moon). `frame.sky` = (planetKm, topKm, camHeightKm, nightScale).

## G-buffer (contracts.ts: `FORMATS`, `GBUFFER_TARGETS`, `DEPTH_STATE`)

Use `GBUFFER_TARGETS` as the fragment `targets` and `DEPTH_STATE` as `depthStencil` in G-buffer pipelines; `SKY_DEPTH_STATE` for sky,
`FORWARD_DEPTH_STATE` for forward. Fragment outputs:

| loc | format | content |
|-----|--------|---------|
| 0 | rgba8unorm | albedo rgb, a = baked AO |
| 1 | rgba16float | rg = octEncode(normal), b = roughness, a = metalness |
| 2 | rgba8unorm | r = MaterialId/255, g = translucency, b = wetness, a = emissive strength (x `EMISSIVE_MAX_NITS`) |
| 3 | rg16float | motion = prevUV - currUV (unjittered `viewProjUnjittered` / `prevViewProj`) |

`MaterialId`: Sky 0, Terrain 1, Grass 2, GateFrame 3, Quad 4, Foliage 5, Rock 6, Emissive 7, Water 8, Fabric 9, Ground 10.
`sunShadow` is r32float (`textureLoad` only), cleared to 1. `giDiffuse.a == 0` means "no GI": lighting falls back to a sky-sampled ambient,
so RT modules must write alpha >= 1/255. Lighting group-2 bindings: 0 albedo, 1 normal, 2 misc, 3 depth, 4 sunShadow, 5 giDiffuse,
6 giSpecular, 7 hdrOut. If no module has `encodeSky`, lighting paints sky pixels from the sky-view LUT (decided once at creation).

## WGSL includes and helpers

`rc.shader(path, defines?)` / `rc.module(path, defines?)` resolve `#include "common/x.wgsl"`, `#ifdef/#ifndef/#else/#endif` and `${NAME}`
against `src/render/shaders/` only (each file is included once). Module shaders belong there (`shaders/<module>/x.wgsl`).

- `common/world_bindings.wgsl` (pulls in math + frame): `terrainTexel, terrainInside, terrainLoad, terrainHeightAt, terrainNormalAt,
  terrainMapsAt`, `blueNoise`, `linearClamp/linearRepeat`.
- `common/math.wgsl`: `PI TAU INV_PI saturate1 sq pcg pcg3 u01 hash11 hash21 hash31 octEncode octDecode basisFromNormal cosineHemisphere
  luminance worldFromDepth(uv, depth) viewRayDir(uv)`.
- `common/pbr.wgsl`: `dGGX vSmithGGXCorrelated fSchlick envBrdfApprox specularOcclusion directLight`.
- `common/atmosphere_sample.wgsl`: `atmosRadiusAtHeight sampleTransmittance sampleSkyView sampleAerialPerspective` and the LUT
  parameterisation helpers (`transmittanceParams, skyViewParams, unitToSubUv/subUvToUnit, apSliceToDistance` ...). The parameterisations
  are documented at the top of that file; the atmosphere module must fill the LUTs exactly that way.

A shader outside `src/render/shaders/` (dev harness) is built as `rc.shader('common/world_bindings.wgsl') + rawWgsl`
(`import x from './x.wgsl?raw'`) with an explicit pipeline layout.

## Writing a module

```ts
export function createFooModule(): RenderModule {
  let pipeline: GPURenderPipeline;
  return {
    name: 'foo',
    init(rc) {
      const module = rc.module('foo/foo.wgsl');
      const layout = rc.device.createPipelineLayout({ bindGroupLayouts: [rc.frame.layout, rc.world.layout, myLayout] });
      pipeline = rc.device.createRenderPipeline({ layout, vertex: { module, buffers }, fragment: { module, targets: GBUFFER_TARGETS },
        depthStencil: DEPTH_STATE });
    },
    encodeGBuffer(pass) { pass.setPipeline(pipeline); pass.setBindGroup(2, myGroup); pass.draw(...); },
  };
}
```

Do not read `GPUTextureUsage`/`GPUShaderStage`/`GPUBufferUsage` at module top level in files that vitest imports (Node has no such globals).
Register static geometry proxies with `rc.rt.setStatic(groupId, prims)`, moving ones with `setDynamic` (<= 64 primitives).
Stub modules (`export function create*Module` in atmosphere/terrain/vegetation/objects/rt `index.ts`) are replaced by their wave-2 owners
and must keep the export name; stub module names end in `-stub`.

## Dev entries and screenshots

`src/dev/<name>.ts` (top-level only; helpers go in `src/dev/<name>/`) with `export default async (canvas, osdCanvas) => {...}` runs at
`/?dev=<name>`. Set `window.__fpv = { ready: true, stats, errors }` once the image is stable (after >= 3 frames, again after resizes).
`src/dev/render.ts` is the reference: default modules, dev props, a CPU dev atmosphere (only while the atmosphere module is a stub) and an
orbiting camera. Params: `t=noon|dusk|night  frames=N  dyn=1  quality=low|medium|high|ultra  scale=0.5  spin=rad/s  fps=60
atmo=dev|real  osd=0`.

```
node tools/shot.mjs --query "dev=render&t=dusk" --out shots/render_dusk.png --size 640x360
node tools/shot.mjs --query "dev=render&dyn=1" --out shots/x.png --eval "JSON.stringify(window.__fpv.stats)"
```

The shot tool fails on `console.error`/page errors and prints warnings; open the PNG and check it by eye. It runs on SwiftShader, so
`stats.gpuMs` timings are not representative. Unit tests: `npx vitest run src/render`.
