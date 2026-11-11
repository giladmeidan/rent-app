import type { TFunction } from 'i18next';

import type { ListingOut } from './api';
import { formatRooms } from './format';

type TitleFacts = Pick<ListingOut, 'listing_type' | 'rooms' | 'street' | 'city'>;

/** "3 חדרים, רחוב …, …" for an apartment, "חדר ב־3 חדרים, רחוב …, …" for a room (spec 0007f): the
 * search card, the listing page's heading and the map pin's name. */
export function cardTitle(t: TFunction, { listing_type, rooms, street, city }: TitleFacts): string {
  const params = { rooms: formatRooms(rooms), street, city };
  return listing_type === 'room'
    ? t('listings.card.roomTitle', params)
    : t('listings.card.title', params);
}
