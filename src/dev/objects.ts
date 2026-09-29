/**
 * Objects dev page: `?dev=objects` shows the race track pieces and the quad model on a rolling dev ground.
 *   ?view=quad|gates|gate|pad|flag|yard   quad: orbit around the hovering quad; gates: from the pad down the gate row; gate/flag: orbit
 *                            gate ?gate=N (default 1 / 5); pad: orbit the start pad; yard: cones, poles, walls and rocks
 *   ?t=noon|dusk|night  ?omega=rad/s (all motors, default 0)  ?track=row|gen|none  ?seed=N  ?amp=terrain relief
 *   ?dist=&az=&el= (orbit, az from +Z toward +X)  ?ox=&oy=&oz= (target offset, m)  ?fov=deg  ?alt=quad height above the pad (default 0.35, on the pad 0.06)  ?qyaw=&qpitch=&qroll= (deg)  ?quad=0 (no quad)
 *   ?active=gate  ?passed=count of gates already flown  ?passgate=gate flown at start  ?hide=1 (setHideQuad)  ?armed=0
 *   ?wind=m/s  ?winddir=deg (compass, clockwise from -Z)  ?time=s  ?freeze=1 (clock stays at ?time, dt 0)  ?orbit=deg/s
 *   ?atmo=real  ?frames=N  ?osd=0  ?quality=low|medium|high|ultra  ?scale=0.5
 * window.__fpv carries { ready, stats, errors, probe(), gbuffer(), info }.
 */
import { DEFAULT_SETTINGS, type CameraState, type Settings, type Vec3 } from '../contracts';
import { createDefaultModules } from '../render/modules';
import { createPostProcessor } from '../render/post';
import type { RenderModule } from '../render/contracts';
import { createObjectsModule } from '../render/objects';
import { Renderer, type FrameInput } from '../render/renderer';
import { isTimeOfDay, makeAstro } from './render/astro';
import { createDevAtmosphere } from './render/atmosphere';
import { drawOsd, probeImage } from './render/osd';
import { lookAtQuat, eulerQuat, orbitPosition } from './objects/camera';
import { createDevGround } from './objects/ground';
import { probeGBuffer } from './objects/probe';
import { makeQuadState } from './objects/quadState';
import { makeDevScene, type TrackKind } from './objects/scene';

const READY_FRAMES = 3;
const MAX_DT = 0.1;
const DEG = Math.PI / 180;

type View = 'quad' | 'gates' | 'gate' | 'pad' | 'flag' | 'yard';
const VIEWS: readonly View[] = ['quad', 'gates', 'gate', 'pad', 'flag', 'yard'];

function readParams() {
  const q = new URLSearchParams(location.search);
  const num = (key: string, fallback: number): number => { const v = Number(q.get(key)); return q.has(key) && q.get(key) !== '' && Number.isFinite(v) ? v : fallback; };
  const view: View = VIEWS.find((k) => k === q.get('view')) ?? 'gates';
  const t = q.get('t');
  const quality = q.get('quality');
  const track = q.get('track');
  const closeUp = view === 'quad';
  return {
    view,
    time: isTimeOfDay(t) ? t : 'noon',
    quality: quality === 'low' || quality === 'medium' || quality === 'ultra' ? quality : 'high' as Settings['quality'],
    track: (track === 'gen' || track === 'none' ? track : 'row') as TrackKind,
    seed: num('seed', 1),
    amp: num('amp', 1.5),
    omega: num('omega', 0),
    dist: num('dist', closeUp ? 0.62 : view === 'pad' ? 4.5 : view === 'yard' ? 20 : view === 'flag' ? 5 : 7),
    az: num('az', closeUp ? 145 : view === 'flag' ? 40 : 25),
    el: num('el', closeUp ? 25 : view === 'pad' ? 28 : view === 'yard' ? 22 : 8),
    fov: num('fov', closeUp ? 50 : 70),
    alt: num('alt', view === 'pad' ? 0.06 : 0.35),
    qyaw: num('qyaw', 0),
    qpitch: num('qpitch', 0),
    qroll: num('qroll', 0),
    quad: q.get('quad') !== '0',
    armed: q.get('armed') !== '0',
    gate: num('gate', view === 'flag' ? 5 : 1),
    off: [num('ox', 0), num('oy', 0), num('oz', 0)] as Vec3,
    active: num('active', -1),
    passed: num('passed', 0),
    passgate: num('passgate', -1),
    hide: q.get('hide') === '1',
    wind: num('wind', 4),
    windDir: num('winddir', 40),
    clock: num('time', 3),
    freeze: q.get('freeze') === '1',
    orbit: num('orbit', 0),
    atmo: q.get('atmo'),
    frames: num('frames', Infinity),
    scale: num('scale', 1),
    osd: q.get('osd') !== '0',
  };
}

function buildModules(atmo: string | null, objects: RenderModule): RenderModule[] {
  const [atmosphere, , , , rt] = createDefaultModules();
  return [atmo === 'real' ? atmosphere : createDevAtmosphere(), createDevGround(), objects, rt];
}

export default async function run(canvas: HTMLCanvasElement, osdCanvas: HTMLCanvasElement): Promise<void> {
  const params = readParams();
  const dev = makeDevScene(params.track, params.seed, params.amp);
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    quality: params.quality,
    dynamicResolution: false,
    renderScale: params.scale,
    observer: { latitudeDeg: 46, longitudeDeg: 8, altitudeM: 300 },
  };
  const objects = createObjectsModule();
  const renderer = await Renderer.create(canvas, settings, buildModules(params.atmo, objects), createPostProcessor());
  renderer.setScene(dev.scene);
  objects.setWind([Math.sin(params.windDir * DEG), -Math.cos(params.windDir * DEG)], params.wind);
  objects.setHideQuad(params.hide);
  if (params.active >= 0) objects.setActiveGate(params.active);
  for (let i = 0; i < params.passed; i++) objects.setGatePassed(i);
  if (params.passgate >= 0) objects.setGatePassed(params.passgate);

  const gates = dev.scene.track?.gates ?? [];
  const gatePos = (i: number): Vec3 => gates[Math.min(Math.max(i, 0), gates.length - 1)]?.pos ?? dev.pad;
  const quadPos: Vec3 = [dev.pad[0], dev.pad[1] + params.alt, dev.pad[2]];
  const quadQuat = eulerQuat(dev.padYaw / DEG + params.qyaw, params.qpitch, params.qroll);
  const quad = makeQuadState(quadPos, quadQuat, params.omega);
  quad.armed = params.armed;
  const target: Vec3 = params.view === 'quad' ? quadPos : params.view === 'pad' ? [dev.pad[0], dev.pad[1] + 0.2, dev.pad[2]] : params.view === 'yard' ? [0, dev.pad[1] + 1, -6] : gatePos(params.gate);
  for (let k = 0; k < 3; k++) target[k] += params.off[k];
  const camera: CameraState = { pos: [0, 0, 0], quat: [0, 0, 0, 1], fovY: params.fov * DEG, aspect: 16 / 9, near: 0.02, far: 1e5 };
  const input: FrameInput = { dt: 0, time: 0, camera, astro: makeAstro(params.time), quad: params.quad ? quad : null };
  const osd = params.osd ? osdCanvas.getContext('2d') : null;

  const placeCamera = (elapsed: number): void => {
    if (params.view === 'gates') {
      camera.pos[0] = dev.pad[0] + 1.2; camera.pos[1] = dev.pad[1] + 1.4; camera.pos[2] = dev.pad[2] + 3;
      lookAtQuat(camera.quat, camera.pos, gatePos(2));
      return;
    }
    orbitPosition(camera.pos, target, params.dist, params.az + params.orbit * elapsed, params.el);
    lookAtQuat(camera.quat, camera.pos, target);
  };

  let framesLeftUntilReady = READY_FRAMES;
  let frameCount = 0;
  let lastNow = performance.now();
  const startNow = lastNow;

  const publish = (): void => {
    window.__fpv = {
      ready: true,
      stats: renderer.stats,
      errors: renderer.errors,
      probe: () => probeImage(renderer),
      gbuffer: () => probeGBuffer(renderer),
      info: { view: params.view, gates: dev.gates, pad: dev.pad, quadPos },
    };
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
    input.dt = params.freeze ? 0 : dt;
    input.time = params.freeze ? params.clock : params.clock + elapsed;
    quad.time = input.time;
    placeCamera(params.freeze ? 0 : elapsed);
    renderer.render(input);
    frameCount++;
    if (osd && frameCount % 10 === 0) drawOsd(osd, osdCanvas, renderer.stats, params.time);
    if (framesLeftUntilReady > 0 && --framesLeftUntilReady === 0) publish();
    if (frameCount < params.frames && !renderer.lost) requestAnimationFrame(tick);
    else if (framesLeftUntilReady > 0) publish();
  };
  requestAnimationFrame(tick);
}
