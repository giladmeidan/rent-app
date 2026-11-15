import type { CardFacts } from '../listings/ListingCard';
import { addDays } from '../listings/format';

/** The example card's match score. */
export const EXAMPLE_SCORE = 91;

/**
 * The landing's static example listing (spec 0009a): a 4-room apartment, floor 2 of 4, 95 m²,
 * 7,200 ₪, with an elevator, one parking spot, partly furnished, pets allowed. Its entry date is
 * 45 days after `today`, so it is never in the past. The caller passes the street and city from
 * he.json.
 */
export function exampleListing({
  street,
  city,
  today,
}: {
  street: string;
  city: string;
  today: string;
}): CardFacts {
  return {
    listing_type: 'apartment',
    rooms: 4,
    street,
    city,
    floor: 2,
    total_floors: 4,
    size_sqm: 95,
    price_ils: 7200,
    available_from: addDays(today, 45),
    elevator: true,
    parking_spots: 1,
    furnished: 'partial',
    pets_allowed: true,
    shelter: null, // spec 0015a: the example card stays as it was
  };
}
