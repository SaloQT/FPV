/**
 * Ray-tracing dev page: `?dev=rt` draws a small test scene (heightfield + registered proxies) so the compute ray tracer's shadows, GI,
 * probes and denoisers can be inspected. WebGPU has no hardware RT; everything here is compute shaders.
 *   ?scene=gate|bleed|canyon|hills|gen|plain   gate: hard shadow of a gate/pole/sphere on flat ground (default); bleed: red box on white ground;
 *                                        canyon: sky occlusion between walls; hills: terrain self-shadowing at dusk; plain: an 8 km plain for cloud shadows; gen: generateTerrain
 *                                        with every proxy kind (default when test=1)
 *   ?dbg=0..6        0 lit, 1 sun shadow, 2 diffuse GI, 3 ambient occlusion, 4 specular, 5 probe SH, 6 variance (r) / history length (g)
 *   ?t=noon|dusk|night  (default: the scene's own)   ?sunel=deg&sunaz=deg  overrides the sun placement (azimuth clockwise from north)
 *   ?frames=N        frames rendered before the page reports ready (default 12: the temporal history needs a few frames)
 *   ?soft=x          shadow-cone scale (1 = the real 0.27 deg solar half angle; 6-8 makes penumbrae visible at this scale)
 *   ?quality=low|medium|high|ultra (default high)   ?tex=1 checker on the ground   ?osd=0
 *   ?mover=orbit|jump&speed=m/s&jump=frame   a dynamic sphere that circles the scene / hops once (dynamic BVH + motion vectors)
 *   ?pan=deg/frame   yaw the camera each frame   ?cx=&cy=&cz=&tx=&ty=&tz=&fov=   camera overrides   ?atmo=real  the real atmosphere module
 *   ?cloud=x&tsec=s  with atmo=real: cumulus coverage 0..1 (0 = clouds off, default the module's own) and the simulated time in seconds the clouds are
 *                    drawn for (they drift with the wind); dbg=1 with a high sun shows the cloud shadow patches on the ground
 *   ?canopy=1        three invisible leaf-crown proxies (sphere + trunk) to inspect the soft canopy shadows on the ground
 *   ?flat=x0,y0,x1,y1   screen-fraction rectangle used by noise() instead of the scene's own flat region
 *   ?test=1          runs the GPU-vs-CPU self test (heightfield DDA vs sampler.raycast, BVH vs brute force) into window.__fpv.rtTest
 * window.__fpv carries { ready, stats, errors, rtStats(), rtTest, probe(), signals(), noise(), series(), line(), project(), frameDiff(), info }.
 */
import { DEFAULT_SETTINGS, type CameraState, type Quat, type Settings, type TerrainSampler, type Vec3 } from '../contracts';
import type { RenderModule, SceneData } from '../render/contracts';
import { createPostProcessor } from '../render/post';
import { Renderer, type FrameInput } from '../render/renderer';
import { createRTModule, RT_DEBUG_VIEWS } from '../render/rt';
import { isTimeOfDay, makeAstro } from './render/astro';
import { createDevAtmosphere } from './render/atmosphere';
import { drawOsd, probeImage } from './render/osd';
import { frameDiff, hdrNonFinite, lineOf, noiseStat, seriesAt, signalReport } from './rt/readback';
import { createDevSceneModule, type MoverMode } from './rt/sceneModule';
import { SCENE_NAMES, buildScene, type SceneName } from './rt/scenes';

const DEG = Math.PI / 180;
const FIXED_DT = 1 / 60;
const DEFAULT_FRAMES = 12;
const TEX_AMPLITUDE = 0.25;

function readParams() {
  const q = new URLSearchParams(location.search);
  const num = (key: string, fallback: number): number => { const v = Number(q.get(key)); return q.has(key) && q.get(key) !== '' && Number.isFinite(v) ? v : fallback; };
  const opt = (key: string): number | null => (q.has(key) && q.get(key) !== '' && Number.isFinite(Number(q.get(key))) ? Number(q.get(key)) : null);
  const test = q.get('test') === '1';
  const scene = SCENE_NAMES.find((n) => n === q.get('scene')) ?? (test ? 'gen' : 'gate');
  const quality = q.get('quality');
  const mover = q.get('mover');
  const t = q.get('t');
  const flatParts = (q.get('flat') ?? '').split(',').map(Number);
  const flat = flatParts.length === 4 && flatParts.every(Number.isFinite) ? (flatParts as [number, number, number, number]) : null;
  const vec = (a: string, b: string, c: string): Vec3 | null => { const x = opt(a), y = opt(b), z = opt(c); return x === null || y === null || z === null ? null : [x, y, z]; };
  return {
    scene: scene as SceneName,
    test,
    dbg: Math.min(Math.max(Math.round(num('dbg', 0)), 0), RT_DEBUG_VIEWS),
    time: isTimeOfDay(t) ? t : null,
    frames: Math.max(1, Math.round(num('frames', DEFAULT_FRAMES))),
    soft: num('soft', 1),
    quality: quality === 'low' || quality === 'medium' || quality === 'ultra' ? quality : 'high' as Settings['quality'],
    checker: q.get('tex') === '1' ? TEX_AMPLITUDE : 0,
    osd: q.get('osd') !== '0',
    realSky: q.get('atmo') === 'real',
    cloud: opt('cloud'),
    tsec: num('tsec', 0),
    mover: (mover === 'orbit' || mover === 'jump' ? mover : 'none') as MoverMode,
    speed: num('speed', 4),
    jump: Math.round(num('jump', 6)),
    pan: num('pan', 0),
    sunEl: opt('sunel'),
    sunAz: opt('sunaz'),
    camPos: vec('cx', 'cy', 'cz'),
    camTarget: vec('tx', 'ty', 'tz'),
    fov: opt('fov'),
    flat,
    canopy: q.get('canopy') === '1',
  };
}

/** Quaternion of a camera at `pos` looking at `target` with +Y up (body -Z forward, +X right, +Y up). */
function lookAt(pos: Vec3, target: Vec3, yawDeg: number, out: Quat): void {
  let fx = target[0] - pos[0], fy = target[1] - pos[1], fz = target[2] - pos[2];
  const c = Math.cos(yawDeg * DEG), s = Math.sin(yawDeg * DEG);
  [fx, fz] = [fx * c - fz * s, fx * s + fz * c];
  const fl = Math.hypot(fx, fy, fz);
  fx /= fl; fy /= fl; fz /= fl;
  const rl = Math.hypot(fx, fz) || 1;
  const rx = -fz / rl, ry = 0, rz = fx / rl;
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  const zx = -fx, zy = -fy, zz = -fz;
  const trace = rx + uy + zz;
  if (trace > 0) {
    const k = Math.sqrt(trace + 1) * 2;
    out[3] = k / 4; out[0] = (uz - zy) / k; out[1] = (zx - rz) / k; out[2] = (ry - ux) / k;
  } else if (rx > uy && rx > zz) {
    const k = Math.sqrt(1 + rx - uy - zz) * 2;
    out[3] = (uz - zy) / k; out[0] = k / 4; out[1] = (ux + ry) / k; out[2] = (zx + rz) / k;
  } else if (uy > zz) {
    const k = Math.sqrt(1 + uy - rx - zz) * 2;
    out[3] = (zx - rz) / k; out[0] = (ux + ry) / k; out[1] = k / 4; out[2] = (zy + uz) / k;
  } else {
    const k = Math.sqrt(1 + zz - rx - uy) * 2;
    out[3] = (ry - ux) / k; out[0] = (zx + rz) / k; out[1] = (zy + uz) / k; out[2] = k / 4;
  }
}

function sunDirection(elevationDeg: number, azimuthDeg: number): Vec3 {
  const e = elevationDeg * DEG, a = azimuthDeg * DEG;
  return [Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a)];
}

const FOLIAGE = { albedo: [0.045, 0.09, 0.025] as Vec3, roughness: 1, metalness: 0 };
const CROWNS: readonly [number, number, number][] = [[2, -8, 4.5], [-6, -2, 3.5], [8, 2, 4]];

/** Registers leaf-crown proxies like the vegetation module does (trunk capsule + volume-equivalent sphere); nothing is drawn, only their shadows show. */
function createCanopyModule(sampler: TerrainSampler): RenderModule {
  return {
    name: 'rt-dev-canopy',
    init() {},
    setScene(rc) {
      rc.rt.setStatic('rt-dev-canopy', CROWNS.flatMap(([x, z, r]) => {
        const y = sampler.heightAt(x, z);
        return [
          { type: 'capsule' as const, a: [x, y, z] as Vec3, b: [x, y + 1.5 * r, z] as Vec3, radius: 0.25, material: FOLIAGE },
          { type: 'sphere' as const, center: [x, y + 2.2 * r, z] as Vec3, radius: r, material: FOLIAGE },
        ];
      }));
    },
  };
}

async function buildModules(realSky: boolean, cloud: number | null, scene: RenderModule, rt: RenderModule, extra: RenderModule[]): Promise<RenderModule[]> {
  const clouds = cloud === null ? {} : { cloudsEnabled: cloud > 0, cloudCoverage: cloud };
  const sky = realSky ? (await import('../render/atmosphere')).createAtmosphereModule(clouds) : createDevAtmosphere();
  return [sky, scene, ...extra, rt];
}

export default async function run(canvas: HTMLCanvasElement, osdCanvas: HTMLCanvasElement): Promise<void> {
  const params = readParams();
  const dev = buildScene(params.scene);
  const time = params.time ?? dev.time;
  const settings: Settings = { ...DEFAULT_SETTINGS, quality: params.quality, dynamicResolution: false, observer: { latitudeDeg: 46, longitudeDeg: 8, altitudeM: 300 } };
  const rt = createRTModule();
  const sceneModule = createDevSceneModule(dev, { mode: params.mover, speed: params.speed, jumpFrame: params.jump }, params.checker);
  const renderer = await Renderer.create(canvas, settings, await buildModules(params.realSky, params.cloud, sceneModule, rt, params.canopy ? [createCanopyModule(dev.sampler)] : []), createPostProcessor());
  const scene: SceneData = { terrain: dev.terrain, sampler: dev.sampler, track: null };
  renderer.setScene(scene);
  rt.setDebugView(params.dbg);
  rt.setOptions({ softness: params.soft });

  const astro = makeAstro(time);
  const sun = params.sunEl !== null || params.sunAz !== null ? [params.sunEl ?? dev.sun?.[0] ?? 40, params.sunAz ?? dev.sun?.[1] ?? 140] : dev.sun;
  if (sun && time !== 'night') {
    astro.sunDir = sunDirection(sun[0], sun[1]);
    astro.sunElevation = sun[0] * DEG;
  }
  const pos = params.camPos ?? dev.camera.pos, target = params.camTarget ?? dev.camera.target;
  const camera: CameraState = { pos, quat: [0, 0, 0, 1], fovY: (params.fov ?? dev.camera.fovDeg) * DEG, aspect: 16 / 9, near: 0.1, far: 1e5 };
  const input: FrameInput = { dt: FIXED_DT, time: 0, camera, astro, quad: null };
  const osd = params.osd ? osdCanvas.getContext('2d') : null;
  let frameCount = 0;

  const step = (): void => {
    lookAt(pos, target, params.pan * frameCount, camera.quat);
    input.time = params.tsec + frameCount * FIXED_DT;
    renderer.render(input);
    frameCount++;
  };
  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    renderer.resize(w, h, window.devicePixelRatio || 1);
    osdCanvas.width = w;
    osdCanvas.height = h;
    camera.aspect = w / h;
  };
  resize();

  const project = (p: Vec3): [number, number] => {
    const [qx, qy, qz, qw] = camera.quat;
    const dx = p[0] - camera.pos[0], dy = p[1] - camera.pos[1], dz = p[2] - camera.pos[2];
    const tx = 2 * (qy * dz - qz * dy), ty = 2 * (qz * dx - qx * dz), tz = 2 * (qx * dy - qy * dx);
    const x = dx - qw * tx + (qy * tz - qz * ty), y = dy - qw * ty + (qz * tx - qx * tz), z = dz - qw * tz + (qx * ty - qy * tx);
    const th = Math.tan(camera.fovY / 2);
    return [0.5 + (0.5 * x) / (-z * th * camera.aspect), 0.5 - (0.5 * y) / (-z * th)];
  };

  const publish = (rtTest?: unknown): void => {
    window.__fpv = {
      ready: true,
      stats: renderer.stats,
      errors: renderer.errors,
      rtStats: () => rt.stats(),
      rtTest,
      probe: () => probeImage(renderer),
      signals: () => signalReport(renderer),
      hdrNonFinite: () => hdrNonFinite(renderer),
      noise: (signal: 'giDiffuse' | 'sunShadow' | 'giSpecular' = 'giDiffuse', frames = 16) => noiseStat(renderer, step, signal, frames, params.flat ?? dev.flatRegion),
      series: (signal: 'giDiffuse' | 'sunShadow', frames: number, at: [number, number]) => seriesAt(renderer, step, signal, frames, at),
      line: (signal: 'giDiffuse' | 'sunShadow' | 'giSpecular', from: [number, number], to: [number, number], count = 32) => lineOf(renderer, signal, from, to, count),
      project,
      frameDiff: () => frameDiff(renderer, step),
      info: { scene: params.scene, time, quality: params.quality, dbg: params.dbg, softness: params.soft, frames: params.frames, mover: params.mover, sun, pan: params.pan },
    };
  };

  const tick = (): void => {
    step();
    if (osd && frameCount % 4 === 0) drawOsd(osd, osdCanvas, renderer.stats, `${params.scene} ${time} dbg${params.dbg}`);
    if (frameCount < params.frames && !renderer.lost) { requestAnimationFrame(tick); return; }
    const done = params.test ? rt.selfTest() : Promise.resolve(undefined);
    done.then(publish, (e) => { console.error(e); window.__fpv = { ready: true, error: String((e as Error).stack ?? e) }; });
  };
  requestAnimationFrame(tick);
}
