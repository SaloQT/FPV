import { choice, slider, fixed, type Control, type SelectControl, type CustomControl } from './menuSchema';
import { el } from './dom';
import { rowFor } from './menuHost';
import { buildControl } from './menuControls';
import { PARK_LAYOUTS, PARK_THEMES, PARK_SIZES } from '../world/park/types';
import { PARK_PRESETS } from '../world/park/recipe';
const named = (values: readonly string[]) => values.map(value => ({ value, label: value[0].toUpperCase() + value.slice(1) }));
export const WORLD_KIND = choice('worldKind', 'Environment', [{ value: 'track', label: 'Flight track' }, { value: 'theme-park', label: 'Theme park' }]);
const size: SelectControl = { kind: 'select', id: 'parkSize', label: 'Park size', options: PARK_SIZES.map(value => ({ value, label: `${value[0].toUpperCase() + value.slice(1)} · ${PARK_PRESETS[value].rides} rides` })),
  read: s => s.parkSize, write: value => ({ parkSize: value as typeof PARK_SIZES[number], parkGuests: PARK_PRESETS[value as typeof PARK_SIZES[number]].guests, parkCoaster: 0 }) };
const coaster: CustomControl = { kind: 'custom', id: 'parkCoaster', label: 'Coaster to follow', build(host) {
  const row = rowFor({ label: 'Coaster to follow' }, 'select'), select = el('select', 'fpv-select'); select.id = row.id; row.ctl.append(select);
  const names = ['Vortex', 'Velocity', 'Sky Talon', 'Timber Run', 'Horizon', 'Lost Mine', 'Stellar Mountain', 'Vortex II', 'Velocity II', 'Sky Talon II'];
  select.addEventListener('change', () => host.change({ parkCoaster: Number(select.value) }));
  return { root: row.root, sync(s) { const count = PARK_PRESETS[s.parkSize].coasters;
    if (select.options.length !== count) { select.replaceChildren(...names.slice(0, count).map((name, i) => new Option(name, String(i)))); }
    select.value = String(Math.min(s.parkCoaster, count - 1)); row.root.hidden = s.parkRoute !== 'coaster';
  } };
} };
const setup: Control[] = [size, choice('parkLayout', 'Layout', named(['random', ...PARK_LAYOUTS])), choice('parkTheme', 'Theme', named(['mixed', ...PARK_THEMES])),
  slider('parkGuests', 'Guests', 0, 10000, 100, fixed(0)), choice('parkRoute', 'Flight route', [{ value: 'free', label: 'Free exploration' }, { value: 'tour', label: 'Park tour' }, { value: 'coaster', label: 'Follow a coaster' }, { value: 'race', label: 'Race course' }]), coaster];
export const PARK_SETUP: Control[] = setup.map((c): CustomControl => ({ kind: 'custom', id: c.id, label: c.label, build(host) {
  const built = buildControl(c, host);
  return { ...built, sync(s) { built.sync(s); built.root.hidden = s.worldKind !== 'theme-park' || c.id === 'parkCoaster' && s.parkRoute !== 'coaster'; } };
} }));
