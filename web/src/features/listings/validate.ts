// Pure field rules for the wizard's details step. They mirror spec 0002a's Data ranges, so a form
// that passes here is not a 422 (except `unknown_area`, which only the API can know).
import { addDays } from './format';
import type { Furnished, ListingInBody, ListingType } from './api';

/** Every input is kept as the string the person typed; `toListingIn` converts. */
export type ListingForm = {
  listing_type: ListingType | null;
  area_id: string;
  city: string;
  street: string;
  rooms: string;
  floor: string;
  total_floors: string;
  size_sqm: string;
  /** Digits only. */
  price_ils: string;
  /** `YYYY-MM-DD`, as `<input type="date">` gives it. */
  available_from: string;
  entry_flexible: boolean;
  elevator: boolean;
  parking_spots: string;
  furnished: Furnished;
  pets_allowed: boolean;
  arnona_ils: string;
  vaad_ils: string;
  description: string;
};

export const emptyForm: ListingForm = {
  listing_type: null,
  area_id: '',
  city: '',
  street: '',
  rooms: '',
  floor: '',
  total_floors: '',
  size_sqm: '',
  price_ils: '',
  available_from: '',
  entry_flexible: false,
  elevator: false,
  parking_spots: '0',
  furnished: 'none',
  pets_allowed: false,
  arnona_ils: '',
  vaad_ils: '',
  description: '',
};

/** The validated fields, in the order they appear on the form (focus goes to the first invalid). */
export const FIELD_ORDER = [
  'area_id',
  'city',
  'street',
  'rooms',
  'floor',
  'total_floors',
  'size_sqm',
  'price_ils',
  'available_from',
  'parking_spots',
  'arnona_ils',
  'vaad_ils',
  'description',
] as const;
export type FieldName = (typeof FIELD_ORDER)[number];

export type FieldError =
  | { key: 'listings.errors.required' }
  | { key: 'listings.errors.range'; min: number; max: number }
  | { key: 'listings.errors.floors' }
  | { key: 'listings.errors.tooLong'; max: number }
  | { key: 'listings.errors.dateRange' };

export type FieldErrors = Partial<Record<FieldName, FieldError>>;

/** The client's latest entry date. The API allows `today + 730` in UTC; the client's today is
 * Israel time, which is a day ahead of UTC near midnight, so one day less never becomes a 422. */
export const AVAILABLE_FROM_MAX_DAYS = 729;

export const LIMITS = {
  city: 40,
  street: 80,
  description: 2000,
  rooms: { min: 1, max: 20 },
  floor: { min: -2, max: 100 },
  size_sqm: { min: 5, max: 1000 },
  price_ils: { min: 500, max: 100_000 },
  parking_spots: { min: 0, max: 5 },
  arnona_ils: { min: 0, max: 20_000 },
  vaad_ils: { min: 0, max: 5_000 },
} as const;

/** Length in code points after trimming, as Postgres `char_length` and Python `len` count. */
export function visibleLength(value: string): number {
  return [...normaliseNewlines(value).trim()].length;
}

function normaliseNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

const required = { key: 'listings.errors.required' } as const;
const INTEGER = /^-?\d+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function text(value: string, max: number): FieldError | undefined {
  const length = visibleLength(value);
  if (length === 0) return required;
  if (length > max) return { key: 'listings.errors.tooLong', max };
  return undefined;
}

function integer(
  value: string,
  range: { min: number; max: number },
  optional = false,
): FieldError | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return optional ? undefined : required;
  const n = Number(trimmed);
  if (!INTEGER.test(trimmed) || n < range.min || n > range.max) {
    return { key: 'listings.errors.range', min: range.min, max: range.max };
  }
  return undefined;
}

function rooms(value: string): FieldError | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return required;
  const n = Number(trimmed);
  const { min, max } = LIMITS.rooms;
  if (!Number.isFinite(n) || n < min || n > max || !Number.isInteger(n * 2)) {
    return { key: 'listings.errors.range', min, max };
  }
  return undefined;
}

function day(value: string, today: string): FieldError | undefined {
  if (value === '') return required;
  // A past date is valid: the listing reads "immediate".
  if (!DAY.test(value) || Number.isNaN(Date.parse(value))) {
    return { key: 'listings.errors.dateRange' };
  }
  if (value > addDays(today, AVAILABLE_FROM_MAX_DAYS)) return { key: 'listings.errors.dateRange' };
  return undefined;
}

/**
 * Per-field error for `form`; an empty object means it can be published. `today` is Israel's
 * calendar day as `YYYY-MM-DD` (`todayInIsrael()`).
 */
export function validate(form: ListingForm, today: string): FieldErrors {
  const found: Record<FieldName, FieldError | undefined> = {
    area_id: form.area_id === '' ? required : undefined,
    city: text(form.city, LIMITS.city),
    street: text(form.street, LIMITS.street),
    rooms: rooms(form.rooms),
    floor: integer(form.floor, LIMITS.floor),
    total_floors: integer(form.total_floors, LIMITS.floor, true),
    size_sqm: integer(form.size_sqm, LIMITS.size_sqm),
    price_ils: integer(form.price_ils, LIMITS.price_ils),
    available_from: day(form.available_from, today),
    parking_spots: integer(form.parking_spots, LIMITS.parking_spots),
    arnona_ils: integer(form.arnona_ils, LIMITS.arnona_ils, true),
    vaad_ils: integer(form.vaad_ils, LIMITS.vaad_ils, true),
    description:
      visibleLength(form.description) > LIMITS.description
        ? { key: 'listings.errors.tooLong', max: LIMITS.description }
        : undefined,
  };
  if (
    found.floor === undefined &&
    found.total_floors === undefined &&
    form.total_floors.trim() !== '' &&
    Number(form.total_floors) < Number(form.floor)
  ) {
    found.total_floors = { key: 'listings.errors.floors' };
  }
  const errors: FieldErrors = {};
  for (const name of FIELD_ORDER) {
    const error = found[name];
    if (error !== undefined) errors[name] = error;
  }
  return errors;
}

export function firstInvalid(errors: FieldErrors): FieldName | undefined {
  return FIELD_ORDER.find((name) => errors[name] !== undefined);
}

const optionalInt = (value: string) => (value.trim() === '' ? null : Number(value));

/** The `POST /listings` body for a form that `validate` accepts. */
export function toListingIn(form: ListingForm): ListingInBody {
  if (form.listing_type === null) throw new Error('toListingIn: no listing type');
  const description = normaliseNewlines(form.description).trim();
  return {
    listing_type: form.listing_type,
    rooms: Number(form.rooms),
    floor: Number(form.floor),
    total_floors: optionalInt(form.total_floors),
    size_sqm: Number(form.size_sqm),
    price_ils: Number(form.price_ils),
    available_from: form.available_from,
    entry_flexible: form.entry_flexible,
    elevator: form.elevator,
    parking_spots: Number(form.parking_spots),
    furnished: form.furnished,
    pets_allowed: form.pets_allowed,
    arnona_ils: optionalInt(form.arnona_ils),
    vaad_ils: optionalInt(form.vaad_ils),
    description: description === '' ? null : description,
    city: form.city.trim(),
    street: form.street.trim(),
    area_id: form.area_id,
  };
}
