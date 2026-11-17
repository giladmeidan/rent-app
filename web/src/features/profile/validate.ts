// Pure field rules for the housing profile form. They mirror spec 0006a's Data ranges, so the body
// `toProfileIn` builds from a form that passes here is not a 422 (except `unknown_area`, which only
// the API can know).
import type { LifestyleAnswers } from '../lifestyle/keys';
import { addDays, todayInIsrael } from '../listings/format';
import { cleanText, visibleLength } from '../listings/validate';
import {
  hasLooking,
  type ContractMonths,
  type FlatmateGender,
  type Gender,
  type Household,
  type SeekerProfileIn,
  type SeekerProfileOut,
  type ShelterNeeded,
} from './api';

/** The client's latest move-in date. The API allows `today + 365` in UTC; the client's today is
 * Israel time, which is a day ahead of UTC near midnight, so one day less never becomes a 422. */
export const MOVE_IN_MAX_DAYS = 364;

export const BUDGET = { min: 500, max: 100_000 } as const;

/**
 * The birth years the form accepts (spec 0007a: age 18 to 99). The API takes the age from the UTC
 * year; Israel's year runs ahead of it near 1 January, so the youngest bound uses UTC and the
 * oldest uses Israel's year: the client's range is never wider than the API's.
 */
export function birthYearRange(now: Date = new Date()): { min: number; max: number } {
  return {
    min: Number(todayInIsrael(now).slice(0, 4)) - 99,
    max: now.getUTCFullYear() - 18,
  };
}

/** The form's state. The budget is kept as typed; the rest keep the API's own types. */
export type ProfileForm = {
  budget_max_ils: string;
  /** `YYYY-MM-DD`, as `<input type="date">` gives it. */
  move_in_date: string;
  move_in_flexible: boolean;
  /** Every chosen id in the order picked, including one `GET /areas` no longer lists (never shown,
   * counted or sent). */
  area_ids: ReadonlySet<string>;
  household: Household | null;
  has_pets: boolean;
  smoker: boolean;
  contract_months: ContractMonths | null;
  parking_needed: number;
  shelter_needed: ShelterNeeded;
  /** The "what I am looking for" part's switch (0010c). Off, its 7 fields go as `null` (PUT
   * replaces, so the server clears them); what was typed stays in memory. */
  looking: boolean;
  /** The personal part's switch ("עליי"; 0007a's room section). Off, gender, birth year, about me
   * and the answers go empty; what was typed stays in memory. */
  personal: boolean;
  gender: Gender | null;
  /** As typed. */
  birth_year: string;
  flatmate_gender: FlatmateGender;
  lifestyle: LifestyleAnswers;
  /** Opt-in to people browse (0008a); sent only with both parts on. */
  people_visible: boolean;
  /** "A little about me", as typed (up to 300 characters). */
  about_me: string;
};

export const emptyProfileForm: ProfileForm = {
  budget_max_ils: '',
  move_in_date: '',
  move_in_flexible: false,
  area_ids: new Set(),
  household: null,
  has_pets: false,
  smoker: false,
  contract_months: null,
  parking_needed: 0,
  shelter_needed: 'any',
  looking: true,
  personal: false,
  gender: null,
  birth_year: '',
  flatmate_gender: 'any',
  lifestyle: {},
  people_visible: false,
  about_me: '',
};

/** A stored profile as the form's starting state. Without the looking part its fields start as an
 * empty form's (never `String(null)`). */
export function formFromProfile(profile: SeekerProfileOut): ProfileForm {
  const looking = hasLooking(profile)
    ? {
        budget_max_ils: String(profile.budget_max_ils),
        move_in_date: profile.move_in_date,
        move_in_flexible: profile.move_in_flexible,
        area_ids: new Set(profile.area_ids),
        household: profile.household,
        has_pets: profile.has_pets,
        smoker: profile.smoker,
        contract_months: profile.contract_months,
        parking_needed: profile.parking_needed,
        shelter_needed: profile.shelter_needed,
      }
    : {
        budget_max_ils: emptyProfileForm.budget_max_ils,
        move_in_date: emptyProfileForm.move_in_date,
        move_in_flexible: emptyProfileForm.move_in_flexible,
        area_ids: new Set<string>(),
        household: emptyProfileForm.household,
        has_pets: emptyProfileForm.has_pets,
        smoker: emptyProfileForm.smoker,
        contract_months: emptyProfileForm.contract_months,
        parking_needed: emptyProfileForm.parking_needed,
        shelter_needed: emptyProfileForm.shelter_needed,
      };
  return {
    ...looking,
    looking: hasLooking(profile),
    personal: profile.gender !== null,
    gender: profile.gender,
    birth_year: String(profile.birth_year ?? ''),
    flatmate_gender: profile.flatmate_gender,
    lifestyle: { ...profile.lifestyle },
    people_visible: profile.people_visible,
    about_me: profile.about_me ?? '',
  };
}

/** The fields that show an error, in the order they appear on the form (focus goes to the first). */
export const FIELD_ORDER = [
  'budget_max_ils',
  'move_in_date',
  'area_ids',
  'household',
  'contract_months',
  'parking_needed',
  'gender',
  'birth_year',
  'about_me',
  // No input carries it: both parts off (0010c). The page shows it as the save bar's alert.
  'form',
] as const;
export type FieldName = (typeof FIELD_ORDER)[number];

export type FieldError =
  | { key: 'listings.errors.required' }
  | { key: 'listings.errors.range'; min: number; max: number }
  | { key: 'profile.errors.moveIn' }
  | { key: 'profile.errors.areas' }
  | { key: 'profile.errors.areasMax' }
  | { key: 'profile.errors.areaInactive' }
  | { key: 'profile.errors.aboutMeTooLong' }
  | { key: 'profile.errors.onePart' }
  /** The API rejected the field (a 422 naming it); its English `msg` is never shown. */
  | { key: 'listings.errors.invalid' };

export type FieldErrors = Partial<Record<FieldName, FieldError>>;

const required = { key: 'listings.errors.required' } as const;
const DIGITS = /^\d+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** At most this many preferred areas (spec 0021b). */
export const AREAS_MAX = 20;

/** The chosen ids that `GET /areas` lists, in the order picked (the first is the map's start, 0021d):
 * what is shown, counted and sent. */
export function visibleAreaIds(form: ProfileForm, areas: readonly { id: string }[]): string[] {
  const listed = new Set(areas.map((a) => a.id));
  return [...form.area_ids].filter((id) => listed.has(id));
}

function areaIds(form: ProfileForm, areas: readonly { id: string }[]): FieldError | undefined {
  const count = visibleAreaIds(form, areas).length;
  if (count === 0) return { key: 'profile.errors.areas' };
  if (count > AREAS_MAX) return { key: 'profile.errors.areasMax' };
  return undefined;
}

function budget(value: string): FieldError | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return required;
  const n = Number(trimmed);
  if (!DIGITS.test(trimmed) || n < BUDGET.min || n > BUDGET.max) {
    return { key: 'listings.errors.range', min: BUDGET.min, max: BUDGET.max };
  }
  return undefined;
}

function birthYear(value: string): FieldError | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const { min, max } = birthYearRange();
  const n = Number(trimmed);
  if (!DIGITS.test(trimmed) || n < min || n > max) {
    return { key: 'listings.errors.range', min, max };
  }
  return undefined;
}

export const ABOUT_ME_MAX = 300;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Empty after cleaning is valid (sent as `null`); otherwise a letter or digit, at most 300. */
function aboutMe(value: string): FieldError | undefined {
  const cleaned = cleanText(value, { multiline: true });
  if (cleaned === '') return undefined;
  if (!LETTER_OR_DIGIT.test(cleaned)) return required;
  if (visibleLength(value, { multiline: true }) > ABOUT_ME_MAX) {
    return { key: 'profile.errors.aboutMeTooLong' };
  }
  return undefined;
}

function moveIn(value: string, today: string): FieldError | undefined {
  if (value === '') return required;
  if (!DAY.test(value) || Number.isNaN(Date.parse(value))) return { key: 'profile.errors.moveIn' };
  // A stored date that has passed fails here until the seeker changes it (0006d UI).
  if (value < today || value > addDays(today, MOVE_IN_MAX_DAYS)) {
    return { key: 'profile.errors.moveIn' };
  }
  return undefined;
}

/**
 * Per-field error for `form`; an empty object means it can be saved. `areas` is `GET /areas`;
 * `today` is Israel's calendar day as `YYYY-MM-DD` (`todayInIsrael()`).
 */
export function validate(
  form: ProfileForm,
  areas: readonly { id: string }[],
  today: string,
): FieldErrors {
  // Each part is checked only while its switch is on; with both off, only that is said (0010c).
  if (!form.looking && !form.personal) return { form: { key: 'profile.errors.onePart' } };
  const looking = form.looking;
  const found: Record<FieldName, FieldError | undefined> = {
    budget_max_ils: looking ? budget(form.budget_max_ils) : undefined,
    move_in_date: looking ? moveIn(form.move_in_date, today) : undefined,
    area_ids: looking ? areaIds(form, areas) : undefined,
    household: looking && form.household === null ? required : undefined,
    contract_months: looking && form.contract_months === null ? required : undefined,
    parking_needed: undefined,
    gender: form.personal && form.gender === null ? required : undefined,
    birth_year: form.personal ? birthYear(form.birth_year) : undefined,
    about_me: form.personal ? aboutMe(form.about_me) : undefined,
    form: undefined,
  };
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

/** The `PUT /me/profile` body for a form that `validate` accepts (0010c: each part, or `null` /
 * its defaults when its switch is off; the people switch and the flatmates preference need both). */
export function toProfileIn(form: ProfileForm, areas: readonly { id: string }[]): SeekerProfileIn {
  const both = form.looking && form.personal;
  let looking: SeekerProfileIn;
  if (form.looking) {
    if (form.household === null || form.contract_months === null) {
      throw new Error('toProfileIn: household and contract are required');
    }
    looking = {
      budget_max_ils: Number(form.budget_max_ils.trim()),
      move_in_date: form.move_in_date,
      move_in_flexible: form.move_in_flexible,
      area_ids: visibleAreaIds(form, areas),
      household: form.household,
      has_pets: form.has_pets,
      smoker: form.smoker,
      contract_months: form.contract_months,
      parking_needed: form.parking_needed,
      shelter_needed: form.shelter_needed,
    };
  } else {
    looking = {
      budget_max_ils: null,
      move_in_date: null,
      move_in_flexible: false,
      area_ids: null,
      household: null,
      has_pets: null,
      smoker: null,
      contract_months: null,
      parking_needed: 0,
      shelter_needed: 'any',
    };
  }
  let personal: Pick<SeekerProfileIn, 'gender' | 'birth_year' | 'lifestyle' | 'about_me'>;
  if (form.personal) {
    if (form.gender === null) {
      throw new Error('toProfileIn: gender is required with the personal switch on');
    }
    const birthYear = form.birth_year.trim();
    const about = cleanText(form.about_me, { multiline: true });
    personal = {
      gender: form.gender,
      ...(birthYear === '' ? {} : { birth_year: Number(birthYear) }),
      lifestyle: { ...form.lifestyle },
      about_me: about === '' ? null : about,
    };
  } else {
    personal = { gender: null, birth_year: null, lifestyle: {}, about_me: null };
  }
  return {
    ...looking,
    ...personal,
    flatmate_gender: both ? form.flatmate_gender : 'any',
    people_visible: both ? form.people_visible : false,
  };
}

/**
 * Field errors from a FastAPI 422 list: each item whose `loc` is `["body", <field>, …]` marks that
 * field `listings.errors.invalid`, whatever the length of `loc`. Empty when no item names a field.
 */
export function serverFieldErrors(detail: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (!Array.isArray(detail)) return errors;
  for (const item of detail as unknown[]) {
    if (typeof item !== 'object' || item === null || !('loc' in item)) continue;
    const loc: unknown = item.loc;
    if (!Array.isArray(loc) || loc[0] !== 'body') continue;
    const field: unknown = loc[1];
    const name = FIELD_ORDER.find((f) => f === field);
    if (name !== undefined) errors[name] = { key: 'listings.errors.invalid' };
  }
  return errors;
}
