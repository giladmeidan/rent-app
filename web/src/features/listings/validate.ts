// Pure field rules for the wizard's details step. They mirror spec 0002a's Data ranges and, via
// `cleanText`, the API's visible-characters rule (`api/app/schemas/_text.py`), so the body
// `toListingIn` builds from a form that passes here is not a 422 (except `unknown_area`, which only
// the API can know).
import { addDays } from './format';
import type { Furnished, ListingInBody, ListingOut, ListingPatch, ListingType } from './api';

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
  | { key: 'listings.errors.dateRange' }
  /** The API rejected the field (a 422 naming it); its English `msg` is never shown. */
  | { key: 'listings.errors.invalid' };

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

// Control, format (bidi marks, zero-width), line- and paragraph-separator, private-use characters,
// lone surrogates, the 66 non-characters and the blank letters (Hangul fillers U+115F, U+1160,
// U+3164, U+FFA0 and braille blank U+2800) and the default-ignorable code points that are
// unassigned in the API's Unicode tables (U+2065, U+FFF0-U+FFF8, U+E0000-U+E00FF and
// U+E01F0-U+E0FFF; review B1): the API rejects them (`visible_characters_only`),
// except ZWNJ / ZWJ and, in the description, `\n`. With the `u` flag a lone surrogate is one code
// point of category `Cs`; a valid pair is the character it encodes. The API's cap on combining marks
// in a row is not mirrored: such a body falls through to the publish error.
const INVISIBLE =
  /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cs}\p{Noncharacter_Code_Point}\u{115F}\u{1160}\u{3164}\u{FFA0}\u{2800}\u{2065}\u{FFF0}-\u{FFF8}\u{E0000}-\u{E00FF}\u{E01F0}-\u{E0FFF}]/gu;
const JOINERS = new Set(['\u200c', '\u200d']);
/** City and street need one letter or digit (`require_alnum` in the API). */
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * The text as the API will accept it: `\r\n` → `\n`, a tab → a space, invisible characters
 * removed (silently, like the trim), then trimmed. Single-line fields lose newlines too.
 */
export function cleanText(value: string, { multiline = false } = {}): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, ' ')
    .replace(INVISIBLE, (ch) => (JOINERS.has(ch) || (multiline && ch === '\n') ? ch : ''))
    .trim();
}

/** Length in code points of `cleanText(value)`, as Postgres `char_length` and Python `len` count. */
export function visibleLength(value: string, options: { multiline?: boolean } = {}): number {
  return [...cleanText(value, options)].length;
}

const required = { key: 'listings.errors.required' } as const;
const INTEGER = /^-?\d+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** City and street: required, at most `max` code points, at least one letter or digit. */
function text(value: string, max: number): FieldError | undefined {
  const cleaned = cleanText(value);
  if (!LETTER_OR_DIGIT.test(cleaned)) return required;
  const length = [...cleaned].length;
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
      visibleLength(form.description, { multiline: true }) > LIMITS.description
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
  const description = cleanText(form.description, { multiline: true });
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
    city: cleanText(form.city),
    street: cleanText(form.street),
    area_id: form.area_id,
  };
}

const fromOptionalInt = (value: number | null) => (value === null ? '' : String(value));

/** The edit wizard's starting form: a stored listing as the strings its inputs hold. */
export function formFromListing(listing: ListingOut): ListingForm {
  return {
    listing_type: listing.listing_type,
    area_id: listing.area_id,
    city: listing.city,
    street: listing.street,
    rooms: String(listing.rooms),
    floor: String(listing.floor),
    total_floors: fromOptionalInt(listing.total_floors),
    size_sqm: String(listing.size_sqm),
    price_ils: String(listing.price_ils),
    available_from: listing.available_from,
    entry_flexible: listing.entry_flexible,
    elevator: listing.elevator,
    parking_spots: String(listing.parking_spots),
    furnished: listing.furnished,
    pets_allowed: listing.pets_allowed,
    arnona_ils: fromOptionalInt(listing.arnona_ils),
    vaad_ils: fromOptionalInt(listing.vaad_ils),
    description: listing.description ?? '',
  };
}

/**
 * The `PATCH /listings/{id}` body: every key of `body` (as `toListingIn` builds it) whose value
 * differs from the stored listing's. A cleared nullable field is already `null` in `body`. Never
 * `status` (pausing stays on "my listings").
 */
export function changedFields(listing: ListingOut, body: ListingInBody): ListingPatch {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(body) as (keyof ListingInBody)[]) {
    const same =
      key === 'rooms' ? Number(listing.rooms) === body.rooms : listing[key] === body[key];
    if (!same) patch[key] = body[key];
  }
  return patch as ListingPatch;
}
