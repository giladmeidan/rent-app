import { describe, expect, it } from 'vitest';

import { inLaunchArea } from '../../../components/map/config';
import he from '../../../locales/he.json';
import { PLACES } from '../places';

const names: Record<string, string> = he.places;

describe('places', () => {
  it('ac3_places_data', () => {
    // 40 to 99 entries: enough to be useful, under OSMF's 100-feature guideline.
    expect(PLACES.length).toBeGreaterThanOrEqual(40);
    expect(PLACES.length).toBeLessThanOrEqual(99);

    // Unique ASCII kebab-case ids without dots (a dot is i18next's key separator).
    const ids = PLACES.map((place) => place.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { id, center, zoom } of PLACES) {
      expect(id, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      // Inside the launch area, at a city's or a neighbourhood's zoom.
      expect(inLaunchArea(...center), id).toBe(true);
      expect([13, 15], id).toContain(zoom);
      // A non-empty Hebrew name.
      expect(names[id]?.trim(), id).toBeTruthy();
    }

    // Every name is the label of exactly one place: no orphan keys, no duplicate names.
    expect(Object.keys(names).sort()).toEqual([...ids].sort());
    const labels = Object.values(names);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
