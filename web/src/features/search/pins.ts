import type { TFunction } from 'i18next';

import type { Bubble, Pin } from '../../components/map/MapCanvas';
import type { MyApplicationOut } from '../applications/api';
import { isWithdrawable } from '../applications/format';
import { cardTitle } from '../listings/cardTitle';
import { formatIls } from '../listings/format';
import { bucket } from '../match/bucket';
import type { ListingPublic } from './api';

export type PinContext = {
  t: TFunction;
  /** Listing ids opened on this device. */
  seen: ReadonlySet<string>;
  /** Rooms the seeker liked. */
  liked: ReadonlySet<string>;
  /** Listings with an open (submitted or shortlisted) application. */
  applied: ReadonlySet<string>;
};

/**
 * The search map's pins (spec 0009v): one per listing with a point. The chip's colour says the
 * match tier, and only a high match (80+) shows its score (Gilad decision 1); a mark says applied
 * (which wins) or liked; `seen` lightens it. `z` ranks by score, best on top: no match below every
 * score, ties in the API's order, the best `z` highest and the worst 1.
 */
export function toPins(items: readonly ListingPublic[], { t, seen, liked, applied }: PinContext) {
  const located = items.filter(
    (item): item is ListingPublic & { lat: number; lng: number } =>
      item.lat !== null && item.lng !== null,
  );
  // A stable sort keeps the API's order among equal scores.
  const ranked = [...located].sort(
    (a, b) => (b.match?.score ?? -Infinity) - (a.match?.score ?? -Infinity),
  );
  const z = new Map(ranked.map((item, i) => [item.id, ranked.length - i]));

  return located.map((item): Pin => {
    const price = formatIls(item.price_ils);
    const tier = item.match === null ? 'none' : bucket(item.match.score);
    const mark = applied.has(item.id) ? 'applied' : liked.has(item.id) ? 'liked' : null;
    const isSeen = seen.has(item.id);
    let label = t('search.map.pin', { title: cardTitle(t, item), price });
    if (item.match !== null) label += t('search.map.pinMatch', { score: item.match.score });
    if (mark === 'applied') label += t('search.map.pinApplied');
    else if (mark === 'liked') label += t('search.map.pinLiked');
    if (isSeen) label += t('search.map.pinSeen');
    return {
      id: item.id,
      lng: item.lng,
      lat: item.lat,
      text:
        tier === 'high' && item.match !== null
          ? t('search.map.pinTextMatch', { price, score: item.match.score })
          : `${price} ${t('listings.units.ils')}`,
      label,
      tier,
      mark,
      seen: isSeen,
      z: z.get(item.id) ?? 1,
    };
  });
}

/** The listings with an open application (submitted or shortlisted): they get the `applied` mark;
 * a declined or withdrawn one gets none. */
export function openApplicationIds(applications: readonly MyApplicationOut[]): Set<string> {
  return new Set(applications.filter((a) => isWithdrawable(a.status)).map((a) => a.listing.id));
}

/** A bubble's spoken name: it zooms in when its members separate, else it lists them. */
export function bubbleLabel(t: TFunction, bubble: Pick<Bubble, 'count' | 'separates'>): string {
  return bubble.separates
    ? t('search.map.bubble', { count: bubble.count })
    : t('search.map.bubbleSamePlace', { count: bubble.count });
}
