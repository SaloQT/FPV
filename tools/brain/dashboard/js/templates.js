// Training templates: named starting points for the dashboard form, the run launcher and `train.mjs --template`. Each one
// overrides some of the trainer defaults (trainingSettings.js) and the run defaults below; settings.test.mjs validates every
// template against the trainer's limits.
import { TRAINING_FIELDS, TRAINING_STYLES, trainingDefaults } from './trainingSettings.js';

/** Run settings outside the PPO and environment configs, as the launcher fills them in. */
export const RUN_DEFAULTS = { minutes: 10, worlds: 48, iters: 0, every: 5, recipes: null, parks: '', styles: TRAINING_STYLES };
export const RUN_FIELDS = [
  { key: 'minutes', label: 'Duration (minutes)' },
  { key: 'worlds', label: 'Worlds' },
  { key: 'iters', label: 'Maximum iterations' },
  { key: 'every', label: 'Checkpoint interval (minutes)' },
  { key: 'recipes', label: 'Random recipe worlds' },
  { key: 'parks', label: 'Theme parks' },
  { key: 'styles', label: 'Track styles' },
];

/** Theme park sizes, and how many coasters each has (src/world/park/recipe.ts PARK_PRESETS). */
export const PARK_SIZES = ['compact', 'destination', 'mega'];
export const PARK_COASTERS = { compact: 3, destination: 7, mega: 10 };
/** The coasters' names in the game's World menu (src/ui/menuPark.ts), by coaster number. */
export const COASTER_NAMES = ['Vortex', 'Velocity', 'Sky Talon', 'Timber Run', 'Horizon', 'Lost Mine', 'Stellar Mountain', 'Vortex II', 'Velocity II', 'Sky Talon II'];
/** The size and route names the pickers show; each route with its icon. */
export const SIZE_NAMES = { compact: 'Compact', destination: 'Destination', mega: 'Mega' };
export const ROUTE_INFO = { race: ['Race course', 'i-flag'], tour: ['Park tour', 'i-route'], coaster: ['Coaster', 'i-coaster'] };
/** Most theme park worlds one run flies. */
export const MAX_PARKS = 8;

/** One park world: { seed, size, route } with route 'race', 'tour' or a zero-based coaster number; null when `item` is not one. */
export function parsePark(item) {
  const [seed, size = 'destination', route = 'race', extra] = String(item).trim().split(':');
  if (extra !== undefined || !/^\d{1,9}$/.test(seed) || !PARK_SIZES.includes(size)) return null;
  const coaster = /^coaster(\d{1,2})$/.exec(route);
  if (coaster ? Number(coaster[1]) >= PARK_COASTERS[size] : route !== 'race' && route !== 'tour') return null;
  return { seed: Number(seed), size, route: coaster ? Number(coaster[1]) : route };
}

/** A park world as `train.mjs --parks` takes it, as short as it goes: the size and route are left out at their defaults. */
export function parkItem({ seed, size, route }) {
  const r = typeof route === 'number' ? `coaster${route}` : route;
  return r !== 'race' ? `${seed}:${size}:${r}` : size !== 'destination' ? `${seed}:${size}` : String(seed);
}

/**
 * A list of theme park worlds as `train.mjs --parks` takes it (" 1337, 7:compact:coaster2" -> "1337,7:compact:coaster2"), or null
 * when it is not one: seed[:compact|destination|mega][:race|tour|coasterN], each at most once, at most MAX_PARKS.
 */
export function normaliseParks(text) {
  const items = String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (items.length > MAX_PARKS) return null;
  const parks = items.map(parsePark);
  if (parks.some((p) => !p)) return null;
  const out = parks.map(parkItem);
  return new Set(out).size === out.length ? out.join(',') : null;
}

/** What a template is for, in the order the gallery groups them. */
export const TEMPLATE_GOALS = {
  start: 'Getting started',
  speed: 'Faster laps',
  smooth: 'Smoother flight',
  reliable: 'Fewer crashes',
};

/** Which starting brain a template suits: a new one, one that already finishes laps, or either. */
export const TEMPLATE_BRAINS = {
  new: 'For a new brain',
  continue: 'Continue a brain that finishes laps',
  any: 'New or continued brain',
};

const CLASSIC = ['race', 'freestyle', 'mountain', 'sprint'];

// The iteration counts of the learning-rate schedules assume about 100 iterations a minute: the default 16384 drones x 32 steps
// on an RX 9070 XT. A faster or slower GPU reaches the final rate earlier or later, which is harmless.
export const TEMPLATES = [
  {
    id: 'balanced', name: 'Balanced', goal: 'start', brain: 'any',
    summary: 'The trainer defaults. A sound start for a new brain and a safe way to continue one.',
    notes: [
      'Every setting at its default: progress and gate rewards, light smoothness penalties, all world styles.',
      'Pick this when you are unsure, then move to a faster or smoother template once it finishes laps.',
    ],
    run: {}, ppo: {}, env: {},
  },
  {
    id: 'first-laps', name: 'First laps', goal: 'start', brain: 'new',
    summary: 'Teaches a new brain to take off and clear gates in order, in calm air on the classic tracks.',
    notes: [
      'A bigger gate reward makes clearing the next gate the obvious goal.',
      'More starts on the pad, so it learns the take-off; calmer and weaker wind.',
      'A longer stall limit gives it time to find each gate. A little more exploration helps it discover the course.',
      'Classic track styles only. Move on to Race pace or Technical precision once it finishes laps.',
    ],
    run: { minutes: 20, styles: CLASSIC, recipes: 0 },
    ppo: { entCoef: 0.002, logStdInit: -0.5 },
    env: { gateReward: 8, padSpawnProb: 0.35, calmProb: 0.6, windMax: 4, stallSeconds: 10 },
  },
  {
    id: 'quick-check', name: 'Quick check', goal: 'start', brain: 'any',
    summary: 'A 3-minute run on a small batch, to try settings or check the trainer works on this PC.',
    notes: [
      '4096 drones on 12 worlds, so the GPU pipelines build and the first iterations arrive quickly.',
      'A checkpoint every minute. Too short to learn much; use it to test, not to train.',
    ],
    run: { minutes: 3, worlds: 12, every: 1 },
    ppo: { envs: 4096 },
    env: {},
  },
  {
    id: 'marathon', name: 'Marathon', goal: 'start', brain: 'new',
    summary: 'Two hours from scratch on twice the worlds, with a learning rate that eases off, for a strong all-rounder.',
    notes: [
      '96 worlds, 16 of them random track-builder recipes: more tracks means less memorising of any one of them.',
      'The learning rate falls from 3e-4 to 3e-5 over about the two hours, so late updates refine rather than reshape.',
      'A checkpoint every 10 minutes.',
    ],
    run: { minutes: 120, worlds: 96, recipes: 16, every: 10 },
    ppo: { lr: 3e-4, lrEnd: 3e-5, lrIterations: 12000 },
    env: {},
  },
  {
    id: 'lap-attack', name: 'Lap time attack', goal: 'speed', brain: 'continue',
    summary: 'Pushes a brain that already finishes laps to fly them faster.',
    notes: [
      'Progress is paid per metre every step, so a higher progress reward pays more for covering ground quickly.',
      'Lower rate and smoothness penalties let it fly harder, tighter turns.',
      'A firm crash penalty keeps the extra speed from turning into crashes; a 5 s stall limit cuts off hesitant flying.',
      'A smaller exploration bonus and a falling learning rate refine the racing line.',
    ],
    run: { minutes: 30 },
    ppo: { lr: 2e-4, lrEnd: 5e-5, lrIterations: 3000, entCoef: 0.0005 },
    env: { progressReward: 1.6, gateReward: 4, crashPenalty: 25, ratePenalty: 1e-4, smoothPenalty: 0.01, stallSeconds: 5, stallPenalty: 3 },
  },
  {
    id: 'race-pace', name: 'Race pace', goal: 'speed', brain: 'continue',
    summary: 'Quicker laps without giving up smooth control. The usual next step after First laps.',
    notes: [
      'A higher progress reward pays for speed, a stronger crash penalty keeps it clean.',
      'Rate and smoothness penalties go up, so the extra speed comes from better lines rather than twitchier sticks.',
      'A 6 s stall limit and a falling learning rate.',
    ],
    run: { minutes: 30 },
    ppo: { lr: 2e-4, lrEnd: 5e-5, lrIterations: 3000 },
    env: { progressReward: 1.3, crashPenalty: 20, ratePenalty: 3e-4, smoothPenalty: 0.04, stallSeconds: 6 },
  },
  {
    id: 'technical', name: 'Technical precision', goal: 'speed', brain: 'any',
    summary: 'Tight courses with split-S, loops, ladders and slaloms, to carry speed through manoeuvres.',
    notes: [
      'Technical, acro and industrial worlds plus race tracks, and 12 random track-builder recipes full of manoeuvres.',
      'A bigger gate reward and crash penalty: every gate of a manoeuvre counts, and clipping one costs.',
      'The rate penalty stays at its default because flips and loops need fast rotation; the stall limit grows to 10 s.',
    ],
    run: { minutes: 30, styles: ['technical', 'acro', 'industrial', 'race'], recipes: 12 },
    ppo: {},
    env: { gateReward: 8, crashPenalty: 25, smoothPenalty: 0.03, stallSeconds: 10, padSpawnProb: 0.15 },
  },
  {
    id: 'theme-park', name: 'Theme park racing', goal: 'start', brain: 'any',
    summary: 'Race courses through three theme parks, between the rides and buildings, alongside generated tracks.',
    notes: [
      'Flies the race courses of a destination park (seed 1337), a compact park (seed 7) and a mega park (seed 31415).',
      'The parks come in as boxes round each course, the space the moving rides sweep included, so the brain learns to keep clear of them.',
      '24 generated worlds keep it flying tracks in general, so it does not just learn the three parks by heart.',
      'A bigger crash penalty: the parks are crowded, and a crash there costs the race.',
    ],
    run: { minutes: 30, worlds: 24, parks: '1337,7:compact,31415:mega' },
    ppo: {},
    env: { crashPenalty: 25 },
  },
  {
    id: 'smooth-lines', name: 'Smooth lines', goal: 'smooth', brain: 'continue',
    summary: 'Irons out twitchy sticks and wobble while keeping most of the pace.',
    notes: [
      'Triples the body rotation rate penalty and quadruples the stick change penalty.',
      'No exploration bonus, so the action spread can shrink and the brain settles on steady inputs.',
      'A falling learning rate keeps what the brain already knows about the tracks.',
    ],
    run: { minutes: 20 },
    ppo: { entCoef: 0, lr: 1.5e-4, lrEnd: 5e-5, lrIterations: 2000 },
    env: { ratePenalty: 6e-4, smoothPenalty: 0.08, crashPenalty: 15 },
  },
  {
    id: 'cinematic', name: 'Cinematic cruise', goal: 'smooth', brain: 'continue',
    summary: 'Calm, flowing flight that is easy to watch and film. Trades lap time for a steady camera.',
    notes: [
      'Heavy rate and stick change penalties and a lower progress reward: smooth arcs matter more than speed.',
      'Classic tracks, calmer air and a 12 s stall limit, so it is never rushed.',
      'Start from a brain that finishes laps; a new brain learns slowly under penalties this strong.',
    ],
    run: { minutes: 30, styles: CLASSIC },
    ppo: { entCoef: 0.0005 },
    env: { progressReward: 0.8, ratePenalty: 1.2e-3, smoothPenalty: 0.15, crashPenalty: 20, stallSeconds: 12, calmProb: 0.5, windMax: 5 },
  },
  {
    id: 'polish', name: 'Final polish', goal: 'smooth', brain: 'continue',
    summary: 'Small, careful updates to a good brain: trims lap times and wobble without forgetting what it knows.',
    notes: [
      'A low, falling learning rate and tighter PPO clipping keep every update small.',
      'Caps the action spread, so training flights stay close to the steady flying the brain does in the game.',
      'Slightly higher rate and smoothness penalties, no exploration bonus.',
    ],
    run: { minutes: 15 },
    ppo: { lr: 5e-5, lrEnd: 1e-5, lrIterations: 1500, clip: 0.1, entCoef: 0, logStdMax: -1 },
    env: { ratePenalty: 3e-4, smoothPenalty: 0.03 },
  },
  {
    id: 'safe-finisher', name: 'Safe finisher', goal: 'reliable', brain: 'continue',
    summary: 'For a brain that crashes too often: crashing costs far more, so it learns safer lines.',
    notes: [
      'A 40 crash penalty and a higher stall penalty make finishing worth more than any shortcut.',
      'A bigger gate reward and a little more smoothing; progress stays at the default.',
      'A falling learning rate. Expect slightly slower laps that end far more often.',
    ],
    run: { minutes: 20 },
    ppo: { lr: 1.5e-4, lrEnd: 5e-5, lrIterations: 2000 },
    env: { crashPenalty: 40, stallPenalty: 4, gateReward: 6, smoothPenalty: 0.03 },
  },
  {
    id: 'all-weather', name: 'All-weather', goal: 'reliable', brain: 'any',
    summary: 'Strong, frequent wind and thin, hot or cold air, so the brain holds its line when you turn the wind up.',
    notes: [
      'Nine in ten episodes have wind, up to 12 m/s from any direction.',
      'Sites up to 2500 m and air from -5 to 40 °C vary the air density, and with it thrust and drag.',
      '64 worlds and a slightly higher crash penalty.',
    ],
    run: { minutes: 30, worlds: 64 },
    ppo: {},
    env: { calmProb: 0.1, windMax: 12, altMax: 2500, tempMin: -5, tempMax: 40, crashPenalty: 15 },
  },
];

export const DEFAULT_TEMPLATE = 'balanced';

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/** Every setting a template starts a run with: the defaults with the template's overrides on top. */
export function templateSettings(id) {
  const t = templateById(id);
  if (!t) throw Error(`Unknown template: ${id}`);
  const defaults = trainingDefaults();
  return {
    ...RUN_DEFAULTS, ...t.run, styles: [...(t.run.styles ?? RUN_DEFAULTS.styles)],
    ppo: { ...defaults.ppo, ...t.ppo, ...(t.ppo.lr !== undefined && t.ppo.lrEnd === undefined ? { lrEnd: t.ppo.lr } : {}) },
    env: { ...defaults.env, ...t.env },
  };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The settings a template changes from the defaults: [{ scope: 'run'|'ppo'|'env', key, label, from, to }]. */
export function templateChanges(id) {
  const t = templateById(id);
  if (!t) return [];
  const settings = templateSettings(id), defaults = trainingDefaults(), out = [];
  for (const f of RUN_FIELDS) {
    if (!same(settings[f.key], RUN_DEFAULTS[f.key])) out.push({ scope: 'run', key: f.key, label: f.label, from: RUN_DEFAULTS[f.key], to: settings[f.key] });
  }
  for (const f of TRAINING_FIELDS) {
    const to = settings[f.scope][f.key], from = defaults[f.scope][f.key];
    if (!same(to, from)) out.push({ scope: f.scope, key: f.key, label: f.label, from, to });
  }
  return out;
}

/** A setting value for people: lists joined, automatic recipe counts named, long decimals shortened. */
export function formatSetting(value) {
  if (value === null || value === undefined) return 'Automatic';
  if (value === '') return 'None';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number') {
    if (value !== 0 && (Math.abs(value) < 1e-3 || Math.abs(value) >= 1e6)) return value.toExponential().replace(/\.?0+e/, 'e').replace('e+', 'e');
    return String(Number(value.toPrecision(6)));
  }
  return String(value);
}
