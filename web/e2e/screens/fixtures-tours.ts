// Fixtures for the tours page screens (spec 0018b, `tours.screens.ts`), shaped as
// `TourAgendaItemOut`. Obviously fake data only. Times are relative to now, so "today", "tomorrow"
// and a later day hold whenever the run is.
import type { TourAgendaItemOut } from '../../src/features/tours/api';
import { OWNER } from './fixtures-listings';

export { OWNER };

const at = (hours: number): string => new Date(Date.now() + hours * 3_600_000).toISOString();

const tour = (
  n: number,
  hours: number,
  overrides: Partial<TourAgendaItemOut>,
): TourAgendaItemOut => ({
  id: `00000000-0000-0000-0000-00000000010${String(n)}`,
  role: 'lister',
  starts_at: at(hours),
  ends_at: at(hours + 0.5),
  conversation_id: `00000000-0000-0000-0000-00000000020${String(n)}`,
  other_name: 'דנה',
  listing: {
    id: `00000000-0000-0000-0000-00000000030${String(n)}`,
    listing_type: 'apartment',
    rooms: 3.5,
    street: 'כצנלסון',
    city: 'גבעתיים',
  },
  ...overrides,
});

/** The lister's rows: one in a minute-ish (today), one tomorrow, one a few days on. */
export const LISTER_ROWS: TourAgendaItemOut[] = [
  tour(1, 1, { other_name: 'דנה' }),
  tour(2, 26, {
    other_name: 'יעל',
    listing: {
      id: '00000000-0000-0000-0000-000000000302',
      listing_type: 'room',
      rooms: 2.5,
      street: 'הרצל',
      city: 'תל אביב',
    },
  }),
  tour(3, 96, { other_name: 'תמר' }),
];

/** The seeker's own booked tour. */
export const SEEKER_ROW: TourAgendaItemOut = tour(4, 50, { role: 'seeker', other_name: 'נועה' });

export const AGENDA: TourAgendaItemOut[] = [...LISTER_ROWS, SEEKER_ROW];
