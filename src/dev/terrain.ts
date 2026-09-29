/**
 * Terrain render dev page: `?dev=terrain` with a real generateTerrain map (512 x 512 samples, 4 m cells, 2 km across).
 *   ?view=ground|air|debug   ground: 2 m above the ground, 120 deg FOV, level gaze; air: 60 m up looking down 45 deg;
 *                            debug: the air camera with the LOD overlay (dbg=1) unless dbg is given
 *   ?dbg=0..4                0 shaded, 1 clipmap level colour + grid (each ring tucks one quad under the finer one, so the
 *                            colours interleave there), 2 slope heat map, 3 layer weights (R rock/gravel, G grass/hay/loam,
 *                            B sand/snow, dirt = brownish mix), 4 wetness
 *   ?seed=N  ?t=noon|dusk|night  ?quality=low|medium|high|ultra  ?x=&z=  camera position in metres (defaults to a per-view spot)
 *   ?yaw=deg (compass, clockwise from north = -Z)  ?pitch=deg  ?alt=m above ground  ?fov=deg  ?spin=deg/s  ?freeze=1 (fixed clock)
 *   ?frames=N (stop rendering after N frames, keeps screenshots fast on software GPUs)  ?osd=0
 *   ?veg=0 drops the vegetation and objects modules so only the ground is drawn
 * window.__fpv carries { ready, stats, errors, terrain: TerrainStats, probe }.
 */
import { DEFAULT_SETTINGS, type CameraState, type Settings, type Vec3 } from '../contracts';
import { createDefaultModules } from '../render/modules';
import { createPostProcessor } from '../render/post';
import { Renderer, type FrameInput } from '../render/renderer';
import type { RenderModule, SceneData } from '../render/contracts';
import { createTerrainModule } from '../render/terrain';
import { createTerrainSampler, generateTerrain } from '../world/terrain';
import { isTimeOfDay, makeAstro } from './render/astro';
import { createDevAtmosphere } from './render/atmosphere';
import { drawOsd, probeImage } from './render/osd';

const RES = 512;
const CELL = 4;
const READY_FRAMES = 3;
const MAX_DT = 0.1;
const DEG = Math.PI / 180;

type View = 'ground' | 'air' | 'debug';

function readParams() {
  const q = new URLSearchParams(location.search);
  const num = (key: string, fallback: number): number => { const v = Number(q.get(key)); return q.has(key) && q.get(key) !== '' && Number.isFinite(v) ? v : fallback; };
  const view = q.get('view');
  const t = q.get('t');
  const quality = q.get('quality');
  const v: View = view === 'ground' || view === 'debug' ? view : 'air';
  return {
    view: v,
    dbg: num('dbg', v === 'debug' ? 1 : 0),
    seed: num('seed', 1),
    time: isTimeOfDay(t) ? t : 'noon',
    quality: quality === 'low' || quality === 'medium' || quality === 'ultra' ? quality : 'high' as Settings['quality'],
    x: num('x', 0),
    z: num('z', 0),
    yaw: num('yaw', 0),
    pitch: num('pitch', v === 'ground' ? -3 : -45),
    alt: num('alt', v === 'ground' ? 2 : 60),
    fov: num('fov', v === 'ground' ? 120 : 60),
    spin: num('spin', 0),
    freeze: q.get('freeze') === '1',
    frames: num('frames', Infinity),
    osd: q.get('osd') !== '0',
    veg: q.get('veg') !== '0',
  };
}

/** Camera looking along compass heading `yaw` (clockwise from -Z) and `pitch` (up positive), body -Z forward. */
function setOrientation(quat: CameraState['quat'], yawDeg: number, pitchDeg: number): void {
  const hy = -yawDeg * DEG * 0.5, hp = pitchDeg * DEG * 0.5;
  const sy = Math.sin(hy), cy = Math.cos(hy), sp = Math.sin(hp), cp = Math.cos(hp);
  quat[0] = cy * sp;
  quat[1] = sy * cp;
  quat[2] = -sy * sp;
  quat[3] = cy * cp;
}

function buildModules(veg: boolean): { modules: RenderModule[]; terrain: ReturnType<typeof createTerrainModule> } {
  const terrain = createTerrainModule();
  const modules = createDefaultModules().filter((m) => veg || !/^(vegetation|objects)/.test(m.name)).map((m) => (m.name.startsWith('terrain') ? terrain : m));
  if (modules[0].name.endsWith('-stub')) modules[0] = createDevAtmosphere();
  return { modules, terrain };
}

export default async function run(canvas: HTMLCanvasElement, osdCanvas: HTMLCanvasElement): Promise<void> {
  const params = readParams();
  const data = generateTerrain({ seed: params.seed, quality: 'low', resolution: RES, cellSize: CELL });
  const sampler = createTerrainSampler(data);
  const scene: SceneData = { terrain: data, sampler, track: null };
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    quality: params.quality,
    dynamicResolution: false,
    observer: { latitudeDeg: 46, longitudeDeg: 8, altitudeM: 300 },
  };
  const { modules, terrain } = buildModules(params.veg);
  const renderer = await Renderer.create(canvas, settings, modules, createPostProcessor());
  renderer.setScene(scene);
  terrain.setDebugView(params.dbg);

  const pos: Vec3 = [params.x, sampler.heightAt(params.x, params.z) + params.alt, params.z];
  const camera: CameraState = { pos, quat: [0, 0, 0, 1], fovY: params.fov * DEG, aspect: 16 / 9, near: 0.05, far: 1e5 };
  setOrientation(camera.quat, params.yaw, params.pitch);
  const input: FrameInput = { dt: 0, time: 0, camera, astro: makeAstro(params.time), quad: null };
  const osd = params.osd ? osdCanvas.getContext('2d') : null;

  let framesLeftUntilReady = READY_FRAMES;
  let frameCount = 0;
  let lastNow = performance.now();
  const startNow = lastNow;

  const publish = (): void => {
    window.__fpv = { ready: true, stats: renderer.stats, errors: renderer.errors, terrain: terrain.stats, probe: () => probeImage(renderer) };
  };
  const resize = (): void => {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight), dpr = window.devicePixelRatio || 1;
    renderer.resize(w, h, dpr);
    osdCanvas.width = w;
    osdCanvas.height = h;
    camera.aspect = w / h;
    framesLeftUntilReady = READY_FRAMES;
  };
  resize();
  window.addEventListener('resize', resize);

  const tick = (now: number): void => {
    const dt = Math.min((now - lastNow) / 1000, MAX_DT);
    lastNow = now;
    const elapsed = (now - startNow) / 1000;
    if (params.spin !== 0) setOrientation(camera.quat, params.yaw + params.spin * elapsed, params.pitch);
    input.dt = params.freeze ? 0 : dt;
    input.time = params.freeze ? 5 : elapsed;
    renderer.render(input);
    frameCount++;
    if (osd && frameCount % 10 === 0) drawOsd(osd, osdCanvas, renderer.stats, params.time);
    if (framesLeftUntilReady > 0 && --framesLeftUntilReady === 0) publish();
    if (frameCount < params.frames && !renderer.lost) requestAnimationFrame(tick);
    else if (framesLeftUntilReady > 0) publish();
  };
  requestAnimationFrame(tick);
}
