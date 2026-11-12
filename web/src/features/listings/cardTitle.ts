import type { TFunction } from 'i18next';

import type { ListingOut } from './api';
import { formatRooms } from './format';

type TitleFacts = Pick<ListingOut, 'listing_type' | 'rooms' | 'street' | 'city'>;

/** "3 חדרים, רחוב …, …" for an apartment, "חדר ב־3 חדרים, רחוב …, …" for a room (spec 0007f), and
 * "חדר אחד, …" / "חדר בדירת חדר אחד, …" for one room (spec 0009b): every listing title on every
 * screen. The only reader of `listings.card.title` / `listings.card.roomTitle`; `count` is the number,
 * so 2.5 selects `_other`. */
export function cardTitle(t: TFunction, { listing_type, rooms, street, city }: TitleFacts): string {
  const params = { count: rooms, rooms: formatRooms(rooms), street, city };
  return listing_type === 'room'
    ? t('listings.card.roomTitle', params)
    : t('listings.card.title', params);
}
