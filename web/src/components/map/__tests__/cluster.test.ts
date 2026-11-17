import { describe, expect, it } from 'vitest';

import { bubbleRect, clusterPins, hitRect, intersects, project, separatesAt } from '../cluster';
import { ISRAEL_BOUNDS, MAP_MAX_ZOOM } from '../config';
import type { Pin, PinTier } from '../MapCanvas';

/** The inverse of `project`: world pixels at `zoom` to `[lng, lat]`. */
function unproject(x: number, y: number, zoom: number): [number, number] {
  const world = 512 * 2 ** zoom;
  const lng = (x / world) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / world))) * 180) / Math.PI;
  return [lng, lat];
}

let n = 0;
function pin(overrides: Partial<Pin> = {}): Pin {
  n += 1;
  return {
    id: `p${String(n).padStart(4, '0')}`,
    lng: 34.78,
    lat: 32.08,
    text: '7,200 ₪',
    label: 'pin',
    tier: 'good',
    mark: null,
    seen: false,
    z: 1,
    ...overrides,
  };
}

/** A pin `dx`, `dy` world pixels from Tel Aviv at `zoom`. */
function pinAt(zoom: number, dx: number, dy: number, overrides: Partial<Pin> = {}): Pin {
  const [x, y] = project(34.78, 32.08, zoom);
  const [lng, lat] = unproject(x + dx, y + dy, zoom);
  return pin({ lng, lat, ...overrides });
}

/** About `metres` north of Tel Aviv. */
const north = (metres: number, overrides: Partial<Pin> = {}) =>
  pin({ lat: 32.08 + metres / 111_320, ...overrides });

/** A seeded pseudo-random generator (mulberry32), so the run is the same every time. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('cluster', () => {
  it('ac3_groups_by_hit_area', () => {
    const zoom = 14;

    // 10 px apart: one bubble at the higher-z pin's point.
    const best = pinAt(zoom, 0, 0, { z: 2, tier: 'high' });
    const near = pinAt(zoom, 10, 0, { z: 1, tier: 'partial' });
    let result = clusterPins([near, best], zoom, new Set());
    expect(result.pins).toEqual([]);
    expect(result.bubbles).toHaveLength(1);
    expect(result.bubbles[0]).toMatchObject({
      id: `cluster:${best.id}`,
      lng: best.lng,
      lat: best.lat,
      count: 2,
      z: 2,
      tier: 'high',
    });
    expect(result.bubbles[0]?.members.map((m) => m.id)).toEqual([best.id, near.id]);

    // 200 px apart: two pins.
    const far = pinAt(zoom, 200, 0);
    result = clusterPins([best, far], zoom, new Set());
    expect(result.bubbles).toEqual([]);
    expect(result.pins.map((p) => p.id)).toEqual([best.id, far.id]);

    // Two rects 0.5 px apart: one bubble (each is grown by 1 px); 2.5 px apart: two pins.
    const width = hitRect(best, zoom).x1 - hitRect(best, zoom).x0;
    expect(width).toBe(84);
    const touching = pinAt(zoom, width + 0.5, 0);
    expect(clusterPins([best, touching], zoom, new Set()).bubbles).toHaveLength(1);
    const apart = pinAt(zoom, width + 2.5, 0);
    expect(clusterPins([best, apart], zoom, new Set()).bubbles).toHaveLength(0);
    // Vertically the hit area is 44 px.
    expect(clusterPins([best, pinAt(zoom, 0, 44.5)], zoom, new Set()).bubbles).toHaveLength(1);
    expect(clusterPins([best, pinAt(zoom, 0, 46.5)], zoom, new Set()).bubbles).toHaveLength(0);

    // The selected pin inside a group: returned alone, the others group without it.
    const a = pinAt(zoom, 0, 0, { z: 3 });
    const b = pinAt(zoom, 5, 0, { z: 2 });
    const c = pinAt(zoom, 10, 0, { z: 1 });
    result = clusterPins([a, b, c], zoom, new Set([a.id]));
    expect(result.pins).toEqual([a]);
    expect(result.bubbles).toHaveLength(1);
    expect(result.bubbles[0]).toMatchObject({ id: `cluster:${b.id}`, count: 2 });
    expect(result.bubbles[0]?.members).toEqual([b, c]);
    // Two pins and one of them selected: two single pins.
    result = clusterPins([a, b], zoom, new Set([b.id]));
    expect(result.bubbles).toEqual([]);
    expect(result.pins).toEqual([a, b]);

    // `separates`: members 300 m apart part at max zoom, 5 m apart never do.
    const low = 12;
    const wide = clusterPins([north(0, { z: 2 }), north(300, { z: 1 })], low, new Set());
    expect(wide.bubbles).toHaveLength(1);
    expect(wide.bubbles[0]?.separates).toBe(true);
    const tight = clusterPins([north(0, { z: 2 }), north(5, { z: 1 })], low, new Set());
    expect(tight.bubbles).toHaveLength(1);
    expect(tight.bubbles[0]?.separates).toBe(false);

    // A mark widens the chip by 20 px; the hit area is never narrower than 44 px.
    expect(
      hitRect(pin({ mark: 'applied' }), zoom).x1 - hitRect(pin({ mark: 'applied' }), zoom).x0,
    ).toBe(104);
    expect(hitRect(pin({ text: '9' }), zoom).x1 - hitRect(pin({ text: '9' }), zoom).x0).toBe(44);
  });

  it('ac4_no_overlap_invariant', () => {
    const random = seeded(9009);
    const [west, south, east, north] = ISRAEL_BOUNDS;
    const texts = ['5,000 ₪', '7,200 ₪ · 87%', '12,500 ₪', '3,400 ₪ · 92%', '900 ₪'];
    const marks: Pin['mark'][] = [null, null, 'applied'];
    const tiers: PinTier[] = ['high', 'good', 'partial', 'none'];
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const pins = Array.from({ length: 200 }, () =>
      pin({
        lng: west + random() * (east - west),
        lat: south + random() * (north - south),
        text: pick(texts),
        mark: pick(marks),
        tier: pick(tiers),
        // Ties on purpose: ranked by id among equals.
        z: 1 + Math.floor(random() * 120),
      }),
    );
    const keepApart = new Set([pins[7]?.id ?? '', pins[42]?.id ?? '']);
    const rank: Record<PinTier, number> = { high: 3, good: 2, partial: 1, none: 0 };

    let bubblesSeen = 0;
    for (const zoom of [6, 9, 12, 14, 17]) {
      const { pins: single, bubbles } = clusterPins(pins, zoom, keepApart);
      bubblesSeen += bubbles.length;

      // Every input pin appears exactly once, as a pin or a bubble member.
      const ids = [
        ...single.map((p) => p.id),
        ...bubbles.flatMap((b) => b.members.map((m) => m.id)),
      ];
      expect(ids.toSorted()).toEqual(pins.map((p) => p.id).toSorted());
      for (const id of keepApart) expect(single.some((p) => p.id === id)).toBe(true);

      // The hit rects grown by 1 px of every item but the keepApart pins are pairwise disjoint.
      const rects = [
        ...single.filter((p) => !keepApart.has(p.id)).map((p) => hitRect(p, zoom)),
        ...bubbles.map((b) => bubbleRect(b, zoom)),
      ];
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const [a, b] = [rects[i], rects[j]];
          if (a === undefined || b === undefined) throw new Error('missing rect');
          expect(
            intersects(a, b),
            `zoom ${String(zoom)}: items ${String(i)} and ${String(j)}`,
          ).toBe(false);
        }
      }

      for (const bubble of bubbles) {
        const [anchor] = bubble.members;
        // At the anchor's point, the best-z member; members by z descending; tier the best one.
        expect(bubble.count).toBe(bubble.members.length);
        expect(bubble.count).toBeGreaterThan(1);
        expect(bubble.id).toBe(`cluster:${anchor?.id ?? ''}`);
        expect([bubble.lng, bubble.lat, bubble.z]).toEqual([anchor?.lng, anchor?.lat, anchor?.z]);
        const zs = bubble.members.map((m) => m.z);
        expect(zs).toEqual(zs.toSorted((x, y) => y - x));
        const best = Math.max(...bubble.members.map((m) => rank[m.tier]));
        expect(rank[bubble.tier]).toBe(best);
        expect(bubble.separates).toBe(separatesAt(bubble.members, MAP_MAX_ZOOM));
      }
    }
    // The run did fold pins (the check above is not vacuous).
    expect(bubblesSeen).toBeGreaterThan(0);
  });

  it('ac5_projection_and_separation', () => {
    for (const zoom of [0, 8, 14]) {
      const world = 512 * 2 ** zoom;
      // lng 0 / lat 0: the centre of the world; lng 180: the east edge.
      const [x, y] = project(0, 0, zoom);
      expect(x).toBeCloseTo(world / 2, 6);
      expect(y).toBeCloseTo(world / 2, 6);
      expect(project(180, 0, zoom)[0]).toBeCloseTo(world, 6);
      expect(project(-180, 0, zoom)[0]).toBeCloseTo(0, 6);
    }
    // Tel Aviv at zoom 0, against a hand-computed value.
    const [tx, ty] = project(34.7818, 32.0853, 0);
    expect(Math.abs(tx - 305.46744889)).toBeLessThan(0.01);
    expect(Math.abs(ty - 207.7766751)).toBeLessThan(0.01);

    // Two points 5 m apart never separate; 300 m apart they do.
    expect(separatesAt([north(0, { z: 2 }), north(5, { z: 1 })], MAP_MAX_ZOOM)).toBe(false);
    expect(separatesAt([north(0, { z: 2 }), north(300, { z: 1 })], MAP_MAX_ZOOM)).toBe(true);
    // A lone pin is one item: nothing to separate.
    expect(separatesAt([pin()], MAP_MAX_ZOOM)).toBe(false);
  });
});
