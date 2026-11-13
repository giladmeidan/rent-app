import { describe, expect, it } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { cardTitle } from '../../listings/cardTitle';
import { formatIls } from '../../listings/format';
import type { ListingPublic } from '../api';
import { bubbleLabel, toPins } from '../pins';
import { publicListing } from './fixtures';

const t = i18n.t;
const NONE: ReadonlySet<string> = new Set();
const ctx = { t, seen: NONE, liked: NONE, applied: NONE };

const located = (overrides: Partial<ListingPublic> = {}) =>
  publicListing({ lat: 32.08, lng: 34.8, ...overrides });
const scored = (score: number, overrides: Partial<ListingPublic> = {}) =>
  located({ match: { score, agrees: ['budget'], differs: null }, ...overrides });
const baseLabel = (listing: ListingPublic) =>
  t('search.map.pin', { title: cardTitle(t, listing), price: formatIls(listing.price_ils) });

describe('toPins', () => {
  it('ac1_tiers_text_and_z', () => {
    const s40 = scored(40, { price_ils: 4000 });
    const s92 = scored(92, { price_ils: 9200 });
    const none = located({ price_ils: 5000, match: null });
    const s64 = scored(64, { price_ils: 6400 });
    const s81 = scored(81, { price_ils: 8100 });
    const nowhere = publicListing({ lat: null, lng: null });
    const pins = toPins([s40, s92, none, nowhere, s64, s81], ctx);

    // Items without a point are skipped; the rest keep the API's order.
    expect(pins.map((p) => p.id)).toEqual([s40.id, s92.id, none.id, s64.id, s81.id]);
    const byId = new Map(pins.map((p) => [p.id, p]));
    const get = (l: ListingPublic) => {
      const found = byId.get(l.id);
      if (found === undefined) throw new Error(`no pin for ${l.id}`);
      return found;
    };

    // z: 92 > 81 > 64 > 40 > no match, the best highest and the worst 1.
    expect([s92, s81, s64, s40, none].map((l) => get(l).z)).toEqual([5, 4, 3, 2, 1]);

    // Tiers: high, high, good, partial, none.
    expect([s92, s81, s64, s40, none].map((l) => get(l).tier)).toEqual([
      'high',
      'high',
      'good',
      'partial',
      'none',
    ]);

    // Only the two high chips show the score.
    expect(get(s92).text).toBe('9,200 ₪ · 92%');
    expect(get(s81).text).toBe('8,100 ₪ · 81%');
    expect(get(s64).text).toBe(`${formatIls(6400)} ${he.listings.units.ils}`);
    expect(get(s40).text).toBe(`${formatIls(4000)} ${he.listings.units.ils}`);
    expect(get(none).text).toBe(`${formatIls(5000)} ${he.listings.units.ils}`);

    // Every label with a match speaks the score, whatever its tier.
    for (const [listing, score] of [
      [s92, 92],
      [s81, 81],
      [s64, 64],
      [s40, 40],
    ] as const) {
      expect(get(listing).label).toBe(`${baseLabel(listing)}, התאמה ${String(score)}%`);
    }
    expect(get(none).label).toBe(baseLabel(none));

    // No marks, nothing seen.
    expect(pins.every((p) => p.mark === null && !p.seen)).toBe(true);

    // Equal scores keep the API's order: the earlier one ranks higher.
    const first = scored(70);
    const second = scored(70);
    const tied = toPins([first, second], ctx);
    expect(tied.map((p) => p.z)).toEqual([2, 1]);
  });

  it('ac2_marks_and_seen', () => {
    const R = scored(85, { listing_type: 'room' });
    const A = scored(70);
    const S = located();
    const D = located();
    const W = located();
    const X = located({ listing_type: 'room' });
    const Q = located();
    const liked = new Set([R.id, X.id]);
    // D (declined) and W (withdrawn) are not in `applied`: `useListingPins` keeps only open ones.
    const applied = new Set([A.id, S.id, X.id]);
    const seen = new Set([A.id, Q.id]);
    const pins = toPins([R, A, S, D, W, X, Q], { t, seen, liked, applied });
    const get = (l: ListingPublic) => pins.find((p) => p.id === l.id);

    expect(get(R)?.mark).toBe('liked');
    expect(get(A)?.mark).toBe('applied');
    expect(get(S)?.mark).toBe('applied');
    // Liked and applied: applied wins.
    expect(get(X)?.mark).toBe('applied');
    expect(get(D)?.mark).toBeNull();
    expect(get(W)?.mark).toBeNull();
    expect(get(Q)?.mark).toBeNull();
    expect(pins.filter((p) => p.seen).map((p) => p.id)).toEqual([A.id, Q.id]);

    // Words in the order match -> mark -> seen.
    expect(get(R)?.label).toBe(`${baseLabel(R)}, התאמה 85%${he.search.map.pinLiked}`);
    expect(get(A)?.label).toBe(
      `${baseLabel(A)}, התאמה 70%${he.search.map.pinApplied}${he.search.map.pinSeen}`,
    );
    expect(get(S)?.label).toBe(`${baseLabel(S)}${he.search.map.pinApplied}`);
    expect(get(X)?.label).toBe(`${baseLabel(X)}${he.search.map.pinApplied}`);
    expect(get(D)?.label).toBe(baseLabel(D));
    expect(get(Q)?.label).toBe(`${baseLabel(Q)}${he.search.map.pinSeen}`);
    // Seen changes no text.
    expect(get(Q)?.text).toBe(`${formatIls(Q.price_ils)} ${he.listings.units.ils}`);
  });

  it('bubble_label_says_zoom_or_list', () => {
    expect(bubbleLabel(t, { count: 3, separates: true })).toBe(
      '3 מודעות קרובות, לחיצה מגדילה את המפה',
    );
    expect(bubbleLabel(t, { count: 2, separates: true })).toBe(he.search.map.bubble_two);
    expect(bubbleLabel(t, { count: 3, separates: false })).toBe(
      '3 מודעות באותה נקודה, לחיצה מציגה אותן',
    );
    expect(bubbleLabel(t, { count: 2, separates: false })).toBe(he.search.map.bubbleSamePlace_two);
  });
});
