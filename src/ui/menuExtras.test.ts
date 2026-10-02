import { describe, expect, it } from 'vitest';
import type { Control, MenuTab } from './menuSchema';
import { extendTabs } from './menuExtras';
import { buildTabs } from './menuTabs';

const ONE = [{ id: 'QUAD_5IN_6S', label: '5-inch quad (6S 1300 mAh, 650 g, 1650 kV)' }];
const TWO = [...ONE, { id: 'QUAD_7IN_6S', label: '7-inch quad' }];

function ids(tab: MenuTab | undefined, section: string): string[] {
  return tab?.sections.find((s) => s.title === section)?.controls.map((c: Control) => c.id) ?? [];
}

const tabOf = (tabs: readonly MenuTab[], id: string): MenuTab | undefined => tabs.find((t) => t.id === id);

describe('extendTabs', () => {
  it('replaces the three time controls with one clock control in the same place', () => {
    const base = buildTabs(ONE);
    const before = ids(tabOf(base, 'simulation'), 'Environment');
    expect(before).toEqual(expect.arrayContaining(['timeOfDay', 'date', 'timeScale']));
    const after = ids(tabOf(extendTabs(base, ONE), 'simulation'), 'Environment');
    expect(after).toEqual(['time', 'windSpeed', 'windDirDeg']);
  });

  it('shows the one real airframe as text and keeps the choice when there are several', () => {
    const one = ids(tabOf(extendTabs(buildTabs(ONE), ONE), 'simulation'), 'Flight');
    expect(one).toContain('airframe');
    expect(one).not.toContain('quadPreset');
    const two = ids(tabOf(extendTabs(buildTabs(TWO), TWO), 'simulation'), 'Flight');
    expect(two).toContain('quadPreset');
    expect(two).not.toContain('airframe');
  });

  it('adds the race start switch to Flight and the stick indicator to the OSD section', () => {
    const tabs = extendTabs(buildTabs(ONE), ONE);
    expect(ids(tabOf(tabs, 'simulation'), 'Flight')).toContain('option.raceStart');
    expect(ids(tabOf(tabs, 'camera'), 'On-screen display')).toEqual(['showOsd', 'osdScale', 'option.showSticks']);
  });

  it('leaves the other tabs as they were', () => {
    const base = buildTabs(ONE);
    const tabs = extendTabs(base, ONE);
    for (const id of ['graphics', 'controls', 'audio']) expect(tabOf(tabs, id)).toBe(tabOf(base, id));
  });

  it('keeps the shared track controls and adds the world link after them, for the pause dialog', () => {
    const tabs = extendTabs(buildTabs(ONE), ONE);
    expect(ids(tabOf(tabs, 'simulation'), 'Track')).toEqual([...ids(tabOf(buildTabs(ONE), 'simulation'), 'Track'), 'shareLink']);
  });
});
