// Pure field rules for the housing profile form. They mirror spec 0006a's Data ranges, so the body
// `toProfileIn` builds from a form that passes here is not a 422 (except `unknown_area`, which only
// the API can know).
import { addDays } from '../listings/format';
import type { ContractMonths, Household, SeekerProfileIn, SeekerProfileOut } from './api';

/** The client's latest move-in date. The API allows `today + 365` in UTC; the client's today is
 * Israel time, which is a day ahead of UTC near midnight, so one day less never becomes a 422. */
export const MOVE_IN_MAX_DAYS = 364;

export const BUDGET = { min: 500, max: 100_000 } as const;

/** The form's state. The budget is kept as typed; the rest keep the API's own types. */
export type ProfileForm = {
  budget_max_ils: string;
  /** `YYYY-MM-DD`, as `<input type="date">` gives it. */
  move_in_date: string;
  move_in_flexible: boolean;
  /** Every checked id, including one `GET /areas` no longer lists (never shown, counted or sent). */
  area_ids: ReadonlySet<string>;
  household: Household | null;
  has_pets: boolean;
  smoker: boolean;
  contract_months: ContractMonths | null;
  parking_needed: number;
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
};

/** A stored profile as the form's starting state. */
export function formFromProfile(profile: SeekerProfileOut): ProfileForm {
  return {
    budget_max_ils: String(profile.budget_max_ils),
    move_in_date: profile.move_in_date,
    move_in_flexible: profile.move_in_flexible,
    area_ids: new Set(profile.area_ids),
    household: profile.household,
    has_pets: profile.has_pets,
    smoker: profile.smoker,
    contract_months: profile.contract_months,
    parking_needed: profile.parking_needed,
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
] as const;
export type FieldName = (typeof FIELD_ORDER)[number];

export type FieldError =
  | { key: 'listings.errors.required' }
  | { key: 'listings.errors.range'; min: number; max: number }
  | { key: 'profile.errors.moveIn' }
  | { key: 'profile.errors.areas' }
  | { key: 'profile.errors.areaInactive' }
  /** The API rejected the field (a 422 naming it); its English `msg` is never shown. */
  | { key: 'listings.errors.invalid' };

export type FieldErrors = Partial<Record<FieldName, FieldError>>;

const required = { key: 'listings.errors.required' } as const;
const DIGITS = /^\d+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The checked ids that `GET /areas` lists, in its order: what is shown, counted and sent. */
export function visibleAreaIds(form: ProfileForm, areas: readonly { id: string }[]): string[] {
  return areas.filter((a) => form.area_ids.has(a.id)).map((a) => a.id);
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
  const found: Record<FieldName, FieldError | undefined> = {
    budget_max_ils: budget(form.budget_max_ils),
    move_in_date: moveIn(form.move_in_date, today),
    area_ids:
      visibleAreaIds(form, areas).length === 0 ? { key: 'profile.errors.areas' } : undefined,
    household: form.household === null ? required : undefined,
    contract_months: form.contract_months === null ? required : undefined,
    parking_needed: undefined,
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

/** The `PUT /me/profile` body for a form that `validate` accepts. */
export function toProfileIn(form: ProfileForm, areas: readonly { id: string }[]): SeekerProfileIn {
  if (form.household === null || form.contract_months === null) {
    throw new Error('toProfileIn: household and contract are required');
  }
  return {
    budget_max_ils: Number(form.budget_max_ils.trim()),
    move_in_date: form.move_in_date,
    move_in_flexible: form.move_in_flexible,
    area_ids: visibleAreaIds(form, areas),
    household: form.household,
    has_pets: form.has_pets,
    smoker: form.smoker,
    contract_months: form.contract_months,
    parking_needed: form.parking_needed,
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
