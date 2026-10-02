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
is in nits. Every value written to an HDR-domain target is multiplied by pre-exposure `frame.params.y` (the CPU's astronomical estimate; the Post exposure stage adds a GPU ratio, see Post). `frame.misc.w` is the key-light
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
`createDefaultModules()` (`modules.ts`) lists the factories (`create*Module` in the `index.ts` of atmosphere, terrain, vegetation, objects and rt) in the
order the hooks run. No placeholder module ships; the dev pages only treat a module whose name ends in `-stub` as one to swap for a dev stand-in.

## Post (post/index.ts)

`PostProcessor.encode` runs: motion blur, TAAU (render size to output size, with history), exposure (histogram + reduce on the resolved image), bloom
(resolved image), then one composite pass into the swapchain (lens and rolling-shutter resample, chromatic aberration, bloom mix, exposure ratio,
vignette, sensor noise, tonemap, grade, video-link artifacts, dither, display encode). All cross-frame state lives in the stages; the orchestrator only
decides whether history is valid (output resize, camera cut, a `capture()` re-encode of the same frame).

- **Exposure** (`exposure.ts`, `shaders/post/histogram.wgsl`): two 64-bin log2-luminance histograms, ground (G-buffer depth > 0) and sky (depth 0, the
  sky pass's pixels), weighted towards the centre and the ground. The sky bins above the ground's metered mean plus a margin are folded onto that level
  before the trimmed mean and the highlight quantile are taken, so a dusk sky cannot set the exposure; with the ground out of frame the cap is off. The
  persistent state is the total exposure in EV (pre-exposure x ratio), so a CPU pre-exposure change never looks like a scene change, and the metering
  never sees the ratio it produces. In the dark the CPU's astronomical luminance estimate replaces the metered mean.
- **Exposure ratio buffer**: 32 bytes, 8 floats, `STORAGE | UNIFORM | COPY_SRC`: `[0]` ratio (multiplies the resolved image), `[1]` sensor gain over the
  daylight reference in EV (drives sensor noise and the tonemap's day or night toe), `[2]` metered mean EV, `[3]` total exposure EV, `[4]` highlight knee
  (scene-linear after the ratio, 1e12 = off), `[5]` roll-off strength 0..1, `[6..7]` spare. Composite binds it as a 32-byte uniform.
- **Tonemap** (`tonemap.wgsl`): a filmic curve on luminance only, so the colour keeps its chromaticity (hue-preserving), with a hyperbolic knee on
  chroma that stops the brightest channel sitting on white, and `compressHighlights`: luminance above the reported knee loses stops, so a dusk sky keeps
  its gradient below the clip. The knee follows the sky-over-ground gap (none under a daylight sky) and is off in the dark and when the camera looks up.

## Dev entries and screenshots

`src/dev/<name>.ts` (top-level only; helpers go in `src/dev/<name>/`) with `export default async (canvas, osdCanvas) => {...}` runs at
`/?dev=<name>`. Set `window.__fpv = { ready: true, stats, errors }` once the image is stable (after >= 3 frames, again after resizes).
`src/dev/render.ts` is the reference: default modules, dev props, an optional CPU dev atmosphere (`atmo=dev`; the real atmosphere module is the default)
and an orbiting camera. Params: `t=noon|dusk|night  frames=N  dyn=1  quality=low|medium|high|ultra  scale=0.5  spin=rad/s  fps=60
atmo=dev|real  osd=0`.

```
node tools/shot.mjs --query "dev=render&t=dusk" --out shots/render_dusk.png --size 640x360
node tools/shot.mjs --query "dev=render&dyn=1" --out shots/x.png --eval "JSON.stringify(window.__fpv.stats)"
```

The shot tool fails on `console.error`/page errors and prints warnings; open the PNG and check it by eye. It runs on SwiftShader, so
`stats.gpuMs` timings are not representative. Unit tests: `npx vitest run src/render`.
