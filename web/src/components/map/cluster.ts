// Pin clustering for the search map (spec 0009v): pins whose hit areas would overlap on screen fold
// into one count bubble. Pure: no React, no `maplibre-gl` (the types below are erased), so the unit
// tests cover it while `MapCanvas` itself is faked.
import { MAP_MAX_ZOOM } from './config';
import type { Bubble, Pin, PinTier } from './MapCanvas';

/** A screen rectangle in world pixels. */
type Rect = { x0: number; y0: number; x1: number; y1: number };

/** The hit area's height, and the least width (the 44 px touch target). */
const HIT = 44;

/**
 * Web Mercator world pixels at `zoom`, with MapLibre's 512 px tiles: `[0, 0]` is the north-west
 * corner of the world, `[W, W]` the south-east one, `W = 512 * 2^zoom`.
 */
export function project(lng: number, lat: number, zoom: number): [x: number, y: number] {
  const world = 512 * 2 ** zoom;
  const phi = (lat * Math.PI) / 180;
  const x = ((lng + 180) / 360) * world;
  const y = ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * world;
  return [x, y];
}

/**
 * The chip's width, deliberately generous: the 13 px text at 8 px a character, its padding and
 * border, and 20 px for a mark's icon and gap (84 px for "7,200 ₪" against the 74 px measured).
 */
export function chipWidth(pin: Pick<Pin, 'text' | 'mark'>): number {
  return 28 + 8 * pin.text.length + (pin.mark !== null ? 20 : 0);
}

/** The marker's hit area centred on its point at `zoom`: 44 high, at least 44 wide. */
export function hitRect(pin: Pick<Pin, 'lng' | 'lat' | 'text' | 'mark'>, zoom: number): Rect {
  const [x, y] = project(pin.lng, pin.lat, zoom);
  const halfWidth = Math.max(HIT, chipWidth(pin)) / 2;
  return { x0: x - halfWidth, y0: y - HIT / 2, x1: x + halfWidth, y1: y + HIT / 2 };
}

/** A bubble's hit area: 44 x 44 at its point (inside its anchor pin's rect). */
export function bubbleRect(bubble: Pick<Bubble, 'lng' | 'lat'>, zoom: number): Rect {
  const [x, y] = project(bubble.lng, bubble.lat, zoom);
  return { x0: x - HIT / 2, y0: y - HIT / 2, x1: x + HIT / 2, y1: y + HIT / 2 };
}

/**
 * The two rects overlap with a positive area once each is grown by 1 px on every side: MapLibre
 * rounds marker positions to whole pixels, so rects under 1 px apart can touch on screen.
 */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x0 - 1 < b.x1 + 1 && b.x0 - 1 < a.x1 + 1 && a.y0 - 1 < b.y1 + 1 && b.y0 - 1 < a.y1 + 1;
}

const TIER_RANK: Record<PinTier, number> = { high: 3, good: 2, partial: 1, none: 0 };

/** Higher `z` first, ties by id. */
const byZ = (a: Pin, b: Pin) => b.z - a.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export type Clustered = { pins: Pin[]; bubbles: Omit<Bubble, 'label'>[] };

/**
 * Folds the pins whose hit rects would intersect at `zoom` into count bubbles. Deterministic and
 * greedy: the `keepApart` pins (the selected one) are returned as they are and take no part. The
 * rest are visited by `z` descending (ties by id); a pin whose rect intersects an existing
 * anchor's joins the first such anchor, otherwise it becomes an anchor itself. An anchor alone is
 * a pin; with members, a bubble at the anchor's own point (a true listing position).
 *
 * Invariant: the rects (grown by 1 px) of every returned item but the `keepApart` pins are
 * pairwise disjoint, since anchors are, and a bubble's 44 x 44 rect lies inside its anchor's.
 * Returned pins keep their input order.
 */
export function clusterPins(
  pins: readonly Pin[],
  zoom: number,
  keepApart: ReadonlySet<string>,
): Clustered {
  const single = new Set<string>(keepApart);
  const bubbles: Omit<Bubble, 'label'>[] = [];
  for (const members of group(
    pins.filter((p) => !keepApart.has(p.id)),
    zoom,
  )) {
    const [anchor] = members;
    if (anchor === undefined) continue;
    if (members.length === 1) {
      single.add(anchor.id);
      continue;
    }
    let tier: PinTier = 'none';
    for (const member of members) {
      if (TIER_RANK[member.tier] > TIER_RANK[tier]) tier = member.tier;
    }
    bubbles.push({
      id: `cluster:${anchor.id}`,
      lng: anchor.lng,
      lat: anchor.lat,
      count: members.length,
      tier,
      z: anchor.z,
      members,
      separates: separatesAt(members, MAP_MAX_ZOOM),
    });
  }
  return { pins: pins.filter((pin) => single.has(pin.id)), bubbles };
}

/** Whether `members` stop folding into one bubble at `zoom`. */
export function separatesAt(members: readonly Pin[], zoom: number): boolean {
  return group(members, zoom).length > 1;
}

/** The greedy grouping: each group's first member is its anchor, members by `z` descending. */
function group(pins: readonly Pin[], zoom: number): Pin[][] {
  const groups: { rect: Rect; members: Pin[] }[] = [];
  for (const pin of [...pins].sort(byZ)) {
    const rect = hitRect(pin, zoom);
    const found = groups.find((g) => intersects(g.rect, rect));
    if (found === undefined) groups.push({ rect, members: [pin] });
    else found.members.push(pin);
  }
  return groups.map((g) => g.members);
}
