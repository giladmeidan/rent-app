// Pure field rules for the wizard's details step. They mirror spec 0002a's Data ranges and, via
// `cleanText`, the API's visible-characters rule (`api/app/schemas/_text.py`), so the body
// `toListingIn` builds from a form that passes here is not a 422 (except `unknown_area`, which only
// the API can know).
import { LIFESTYLE_KEYS, type LifestyleAnswers } from '../lifestyle/keys';
import { HOUSEHOLDS } from './constants';
import { addDays } from './format';
import type {
  ContractMonths,
  Furnished,
  GenderPreference,
  Household,
  ListingInBody,
  ListingOut,
  ListingPatch,
  ListingType,
  ApartmentFactKey,
  Condition,
  Poster,
  RoomFactKey as RoomFact,
  Shelter,
} from './api';

/** A yes / no fact the lister may leave unsaid (0010f): `''` is "לא לציין" (sent as `null`). */
export type YesNo = 'yes' | 'no' | '';

/** Every input is kept as the string the person typed; `toListingIn` converts. The preferences
 * (0006e) and the room fields (0007e) hold the API values, except the ages and the flat facts
 * (0010f). The room fields are kept when the type switches to an apartment (switching back
 * restores them) but never sent for one. */
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
  accepted_households: Household[];
  smoking_allowed: boolean;
  min_contract_months: ContractMonths | null;
  gender_preference: GenderPreference;
  /** The flatmates already living there; `null` until one is chosen (required for a room). */
  flatmates_count: number | null;
  /** The ages as typed: slot `i` is flatmate `i + 1`. Slots beyond the count are kept (lowering and
   * raising the count loses nothing) but ignored; read a slot as `ages[i] ?? ''`. */
  flatmate_ages: string[];
  /** The flat's questionnaire: answered keys only. */
  lifestyle: LifestyleAnswers;
  /** The flat facts (0010f), all optional: the room's own size as typed, `''` = not said. */
  room_size_sqm: string;
  private_bathroom: YesNo;
  balcony: YesNo;
  bills_included: YesNo;
  poster: Poster | '';
  /** The flat's protected space (0015a), optional, on any listing; `''` = not said. */
  shelter: Shelter | '';
  /** The apartment facts (0014b), all optional, with `balcony`; `''` = not said. */
  air_conditioning: YesNo;
  condition: Condition | '';
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
  accepted_households: [...HOUSEHOLDS],
  smoking_allowed: true,
  min_contract_months: null,
  gender_preference: 'any',
  flatmates_count: null,
  flatmate_ages: [],
  lifestyle: {},
  room_size_sqm: '',
  private_bathroom: '',
  balcony: '',
  bills_included: '',
  poster: '',
  shelter: '',
  air_conditioning: '',
  condition: '',
};

/** The validated fields, in the order they appear on the form (focus goes to the first invalid):
 * the details step's, then the preferences step's (`smoking_allowed`, `gender_preference` and
 * `lifestyle` always hold valid values, never an error). */
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
  'shelter',
  'parking_spots',
  'arnona_ils',
  'vaad_ils',
  'description',
  'accepted_households',
  'min_contract_months',
  'flatmates_count',
  'flatmate_ages',
  'room_size_sqm',
] as const;
export type FieldName = (typeof FIELD_ORDER)[number];

export type FieldError =
  | { key: 'listings.errors.required' }
  | { key: 'listings.errors.range'; min: number; max: number }
  | { key: 'listings.errors.floors' }
  | { key: 'listings.errors.tooLong'; max: number }
  | { key: 'listings.errors.dateRange' }
  | { key: 'listings.errors.households' }
  | { key: 'listings.errors.shelterRequired' }
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
  flatmates_count: { min: 1, max: 7 },
  flatmate_age: { min: 18, max: 99 },
  /** At most the flat's `size_sqm` too (`roomSizeError`). */
  room_size_sqm: { min: 4, max: 100 },
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
 * Per-field error for the details step of `form`; an empty object means it can move on. `today` is Israel's
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
    shelter: form.shelter === '' ? { key: 'listings.errors.shelterRequired' } : undefined,
    parking_spots: integer(form.parking_spots, LIMITS.parking_spots),
    arnona_ils: integer(form.arnona_ils, LIMITS.arnona_ils, true),
    vaad_ils: integer(form.vaad_ils, LIMITS.vaad_ils, true),
    description:
      visibleLength(form.description, { multiline: true }) > LIMITS.description
        ? { key: 'listings.errors.tooLong', max: LIMITS.description }
        : undefined,
    // The preferences step's (`validatePreferences`).
    accepted_households: undefined,
    min_contract_months: undefined,
    flatmates_count: undefined,
    flatmate_ages: undefined,
    room_size_sqm: undefined,
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

/** One age slot: empty, or a whole number in the API's range (trimmed). */
export function flatmateAgeError(slot: string): FieldError | undefined {
  return integer(slot, LIMITS.flatmate_age, true);
}

/** The index of the first of the room's `count` age slots that `flatmateAgeError` rejects. */
export function firstInvalidAge(form: ListingForm): number | undefined {
  for (let i = 0; i < (form.flatmates_count ?? 0); i += 1) {
    if (flatmateAgeError(form.flatmate_ages[i] ?? '') !== undefined) return i;
  }
  return undefined;
}

/** The largest room size the API takes (0010f): the flat's `size_sqm` once it is a whole number,
 * and never above 100. */
export function roomSizeMax(form: ListingForm): number {
  const flat = form.size_sqm.trim();
  const { max } = LIMITS.room_size_sqm;
  return flat !== '' && Number.isInteger(Number(flat)) ? Math.min(max, Number(flat)) : max;
}

/** The room's own size (0010f): empty, or a whole number from 4 to `roomSizeMax`. */
export function roomSizeError(form: ListingForm): FieldError | undefined {
  return integer(
    form.room_size_sqm,
    { min: LIMITS.room_size_sqm.min, max: roomSizeMax(form) },
    true,
  );
}

/** The preferences step's errors: at least one household; for a room, the flatmates count, an
 * age range error for the ages as a group (the slot is `firstInvalidAge`) and the room size. */
export function validatePreferences(form: ListingForm): FieldErrors {
  const errors: FieldErrors = {};
  if (form.accepted_households.length === 0) {
    errors.accepted_households = { key: 'listings.errors.households' };
  }
  if (form.listing_type === 'room') {
    if (form.flatmates_count === null) errors.flatmates_count = required;
    const slot = firstInvalidAge(form);
    if (slot !== undefined) errors.flatmate_ages = flatmateAgeError(form.flatmate_ages[slot] ?? '');
    const roomSize = roomSizeError(form);
    if (roomSize !== undefined) errors.room_size_sqm = roomSize;
  }
  return errors;
}

export function firstInvalid(errors: FieldErrors): FieldName | undefined {
  return FIELD_ORDER.find((name) => errors[name] !== undefined);
}

const optionalInt = (value: string) => (value.trim() === '' ? null : Number(value));

const byNumber = (a: number, b: number) => a - b;

/** The ages of the first `count` slots that are not empty, ascending (never the default
 * lexicographic sort: 100 after 27). */
function agesOf(form: ListingForm): number[] {
  const ages: number[] = [];
  for (let i = 0; i < (form.flatmates_count ?? 0); i += 1) {
    const slot = (form.flatmate_ages[i] ?? '').trim();
    if (slot !== '') ages.push(Number(slot));
  }
  return ages.sort(byNumber);
}

/** The answered keys only, in `LIFESTYLE_KEYS` order. */
function answeredLifestyle(answers: LifestyleAnswers): LifestyleAnswers {
  const answered: LifestyleAnswers = {};
  for (const key of LIFESTYLE_KEYS) {
    const answer = answers[key];
    if (answer !== undefined) answered[key] = answer;
  }
  return answered;
}

const yesNoValue = (value: YesNo): boolean | null => (value === '' ? null : value === 'yes');
const yesNoOf = (value: boolean | null): YesNo => (value === null ? '' : value ? 'yes' : 'no');

/** The `POST /listings` body for a form that `validate` and `validatePreferences` accept. Every
 * key: an apartment sends the room fields' defaults (the only values the API takes for one), and
 * never the room-only flat facts (0010f), which a room sends with `null` for "not said". An
 * apartment sends `balcony` and its own facts (0014b) instead, `null` for "not said". Both send
 * the flat's protected space (0015a), `null` for "not said". */
export function toListingIn(form: ListingForm): ListingInBody {
  if (form.listing_type === null) throw new Error('toListingIn: no listing type');
  const description = cleanText(form.description, { multiline: true });
  const room = form.listing_type === 'room';
  const facts: Pick<ListingInBody, RoomFact | ApartmentFactKey> = room
    ? {
        room_size_sqm: optionalInt(form.room_size_sqm),
        private_bathroom: yesNoValue(form.private_bathroom),
        balcony: yesNoValue(form.balcony),
        bills_included: yesNoValue(form.bills_included),
        poster: form.poster === '' ? null : form.poster,
      }
    : {
        balcony: yesNoValue(form.balcony),
        air_conditioning: yesNoValue(form.air_conditioning),
        condition: form.condition === '' ? null : form.condition,
      };
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
    // No `city`: the server names the chosen settlement (spec 0021a1).
    street: cleanText(form.street),
    area_id: form.area_id,
    // Canonical order, whatever order they were checked in.
    accepted_households: HOUSEHOLDS.filter((h) => form.accepted_households.includes(h)),
    smoking_allowed: form.smoking_allowed,
    min_contract_months: form.min_contract_months,
    gender_preference: room ? form.gender_preference : 'any',
    flatmates_count: room ? form.flatmates_count : null,
    flatmate_ages: room ? agesOf(form) : [],
    lifestyle: room ? answeredLifestyle(form.lifestyle) : {},
    shelter: form.shelter === '' ? null : form.shelter,
    ...facts,
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
    accepted_households: [...listing.accepted_households],
    smoking_allowed: listing.smoking_allowed,
    min_contract_months: listing.min_contract_months,
    gender_preference: listing.gender_preference,
    flatmates_count: listing.flatmates_count,
    // Copies: `listing` is the query cache's object.
    flatmate_ages: [...listing.flatmate_ages].sort(byNumber).map(String),
    lifestyle: { ...listing.lifestyle },
    room_size_sqm: fromOptionalInt(listing.room_size_sqm),
    private_bathroom: yesNoOf(listing.private_bathroom),
    balcony: yesNoOf(listing.balcony),
    bills_included: yesNoOf(listing.bills_included),
    poster: listing.poster ?? '',
    shelter: listing.shelter ?? '',
    air_conditioning: yesNoOf(listing.air_conditioning),
    condition: listing.condition ?? '',
  };
}

/** Same households, in any order. */
function sameSet(a: readonly Household[], b: readonly Household[]): boolean {
  return a.length === b.length && a.every((h) => b.includes(h));
}

/** Same numbers, in any order. Sorts copies: neither input is changed. */
function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  const left = [...a].sort(byNumber);
  const right = [...b].sort(byNumber);
  return left.length === right.length && left.every((n, i) => n === right[i]);
}

/** Same keys with the same values, in any key order. */
function sameEntries(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>) {
  const entries = Object.entries(a);
  return entries.length === Object.keys(b).length && entries.every(([key, n]) => b[key] === n);
}

/** The room-only keys of the body (0007a; the flat facts, 0010f, but `balcony`, any type's since
 * 0014b). */
const ROOM_FIELDS: ReadonlySet<string> = new Set([
  'gender_preference',
  'flatmates_count',
  'flatmate_ages',
  'lifestyle',
  'room_size_sqm',
  'private_bathroom',
  'bills_included',
  'poster',
]);

/**
 * The `PATCH /listings/{id}` body: every key of `body` (as `toListingIn` builds it) whose value
 * differs from the stored listing's. A cleared nullable field is already `null` in `body`; the
 * households and the ages are compared as sets (the API may store them in any order), the
 * questionnaire by its entries. Never `status` (pausing stays on "my listings") and never
 * `listing_type` (spec 0010a: the type is fixed at create, and the API refuses the key). An
 * apartment never sends room fields (a `null` count is a 422).
 */
export function changedFields(listing: ListingOut, body: ListingInBody): ListingPatch {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(body) as (keyof ListingInBody)[]) {
    if (key === 'listing_type') continue;
    if (body.listing_type === 'apartment' && ROOM_FIELDS.has(key)) continue;
    let same: boolean;
    if (key === 'rooms') same = Number(listing.rooms) === body.rooms;
    else if (key === 'accepted_households') {
      same = sameSet(listing.accepted_households, body.accepted_households);
    } else if (key === 'flatmate_ages') {
      same = sameNumbers(listing.flatmate_ages, body.flatmate_ages);
    } else if (key === 'lifestyle') same = sameEntries(listing.lifestyle, body.lifestyle);
    else same = listing[key] === body[key];
    if (!same) patch[key] = body[key];
  }
  return patch as ListingPatch;
}
