// Fixtures for the tours page screens (spec 0018b, `tours.screens.ts`), shaped as
// `TourAgendaItemOut`. Obviously fake data only. Tours sit at noon (Israel time) on today, tomorrow
// and later Israeli days, so the "today" / "tomorrow" headings hold whenever the run is.
import { addDays, todayInIsrael } from '../../src/features/listings/format';
import type { TourAgendaItemOut } from '../../src/features/tours/api';
import { OWNER } from './fixtures-listings';

export { OWNER };

const israelHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem',
  hour: '2-digit',
  hourCycle: 'h23',
});

/** 12:00 Israel time on `isoDay` (09:00Z in summer, 10:00Z in winter) plus `minutes`, as an ISO instant. */
function noon(isoDay: string, minutes = 0): string {
  const winter = new Date(`${isoDay}T10:00:00Z`);
  const start = israelHour.format(winter) === '12' ? winter : new Date(`${isoDay}T09:00:00Z`);
  return new Date(start.getTime() + minutes * 60_000).toISOString();
}

const today = todayInIsrael();

const tour = (
  n: number,
  day: string,
  overrides: Partial<TourAgendaItemOut>,
): TourAgendaItemOut => ({
  id: `00000000-0000-0000-0000-00000000010${String(n)}`,
  role: 'lister',
  starts_at: noon(day),
  ends_at: noon(day, 30),
  conversation_id: `00000000-0000-0000-0000-00000000020${String(n)}`,
  other_name: 'דנה',
  listing: {
    id: `00000000-0000-0000-0000-00000000030${String(n)}`,
    listing_type: 'apartment',
    rooms: 3.5,
    street: 'כצנלסון',
    city: 'גבעתיים',
    cover: null,
  },
  ...overrides,
});

/** The lister's rows: one today, one tomorrow, one four days on. */
export const LISTER_ROWS: TourAgendaItemOut[] = [
  tour(1, today, { other_name: 'דנה' }),
  tour(2, addDays(today, 1), {
    other_name: 'יעל',
    listing: {
      id: '00000000-0000-0000-0000-000000000302',
      listing_type: 'room',
      rooms: 2.5,
      street: 'הרצל',
      city: 'תל אביב',
      cover: null,
    },
  }),
  tour(3, addDays(today, 4), { other_name: 'תמר' }),
];

/** The seeker's own booked tour. */
export const SEEKER_ROW: TourAgendaItemOut = tour(4, addDays(today, 2), {
  role: 'seeker',
  other_name: 'נועה',
});

export const AGENDA: TourAgendaItemOut[] = [...LISTER_ROWS, SEEKER_ROW];
