import { describe, expect, it } from 'vitest';

import he from '../../../locales/he.json';
import type { Poster } from '../../listings/api';
import { POSTERS } from '../../listings/constants';

const nonEmpty = (value: unknown) => typeof value === 'string' && value.trim() !== '';

/** Every `Poster` value, checked by the compiler: a value added to the API's `Literal` fails the
 * type check here until it is listed. */
const EVERY_POSTER: Record<Poster, true> = { lives_here: true, leaving: true, landlord: true };

describe('poster catalogue', () => {
  it('ac10 every Poster value has its wizard and fact keys', () => {
    // `RoomFields`, `RoomPreview` and `RoomFacts` look these up by template key, which `i18n-check`
    // cannot see (spec 0010f).
    expect([...POSTERS].sort()).toEqual(Object.keys(EVERY_POSTER).sort());
    const wizard = he.listings.room.poster as unknown as Record<string, unknown>;
    const facts = he.rooms.facts.values.poster as unknown as Record<string, unknown>;
    for (const poster of POSTERS) {
      expect(nonEmpty(wizard[poster]), `listings.room.poster.${poster}`).toBe(true);
      expect(nonEmpty(facts[poster]), `rooms.facts.values.poster.${poster}`).toBe(true);
    }
    expect(nonEmpty(he.listings.room.poster.title)).toBe(true);
    expect(nonEmpty(he.listings.room.poster.livesHereHint)).toBe(true);
  });
});
