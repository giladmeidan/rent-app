import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { DateReadback, withReadback } from '../../components/DateReadback';
import { formatRooms } from '../listings/format';
import {
  FEATURES,
  PRICE_MAX,
  ROOMS_MAX,
  ROOMS_MIN,
  parseFilters,
  type Feature,
  type Filters,
} from './filters';

type FormKey = Exclude<keyof Filters, 'sort' | 'view'>;
/** Every filter the form owns, present (as `undefined` when unset) so it overrides the URL's. */
export type FormFilters = { [K in FormKey]: Filters[K] };

type Props = {
  /** The URL's filters; the form is remounted (keyed by the URL) whenever they change. */
  filters: Filters;
  onApply: (values: FormFilters) => void;
  onClear: () => void;
};

type Values = {
  price_min: string;
  price_max: string;
  rooms_min: string;
  rooms_max: string;
  available_by: string;
  /** The "סוג" boxes; at least one stays on (both on = no `listing_type`). */
  apartment: boolean;
  room: boolean;
} & Record<Feature, boolean>;

type ErrorField = 'price_min' | 'price_max' | 'rooms_max';
type FieldError =
  | { key: 'listings.errors.range'; min: number; max: number }
  | { key: 'search.errors.priceOrder' }
  | { key: 'search.errors.roomsOrder' };
type Errors = Partial<Record<ErrorField, FieldError>>;

// 1 … 10 rooms in half steps, as the listing wizard offers.
const ROOM_OPTIONS = Array.from(
  { length: (ROOMS_MAX - ROOMS_MIN) * 2 + 1 },
  (_, i) => ROOMS_MIN + i / 2,
);

const toText = (value: number | undefined) => (value === undefined ? '' : String(value));

function initialValues(filters: Filters): Values {
  return {
    price_min: toText(filters.price_min),
    price_max: toText(filters.price_max),
    rooms_min: toText(filters.rooms_min),
    rooms_max: toText(filters.rooms_max),
    available_by: filters.available_by ?? '',
    apartment: filters.listing_type !== 'room',
    room: filters.listing_type !== 'apartment',
    pets: filters.pets === true,
    furnished: filters.furnished === true,
    elevator: filters.elevator === true,
    parking: filters.parking === true,
  };
}

const EMPTY = initialValues({});

function validate(values: Values): Errors {
  const errors: Errors = {};
  const priceMin = values.price_min === '' ? undefined : Number(values.price_min);
  const priceMax = values.price_max === '' ? undefined : Number(values.price_max);
  const range = { key: 'listings.errors.range', min: 0, max: PRICE_MAX } as const;
  if (priceMin !== undefined && priceMin > PRICE_MAX) errors.price_min = range;
  if (priceMax !== undefined && priceMax > PRICE_MAX) errors.price_max = range;
  if (
    errors.price_min === undefined &&
    errors.price_max === undefined &&
    priceMin !== undefined &&
    priceMax !== undefined &&
    priceMin > priceMax
  ) {
    errors.price_max = { key: 'search.errors.priceOrder' };
  }
  if (
    values.rooms_min !== '' &&
    values.rooms_max !== '' &&
    Number(values.rooms_min) > Number(values.rooms_max)
  ) {
    errors.rooms_max = { key: 'search.errors.roomsOrder' };
  }
  return errors;
}

/** Valid form values as filters, through the URL parser (so the form can only write what it reads). */
function toFilters(values: Values): FormFilters {
  const params = new URLSearchParams();
  for (const key of ['price_min', 'price_max'] as const) {
    // `007` → `7`: the URL holds canonical numbers.
    if (values[key] !== '') params.set(key, String(Number(values[key])));
  }
  for (const key of ['rooms_min', 'rooms_max', 'available_by'] as const) {
    if (values[key] !== '') params.set(key, values[key]);
  }
  // Exactly one box on is a filter; both on is none (the form never lets both go off).
  if (values.apartment !== values.room) {
    params.set('listing_type', values.apartment ? 'apartment' : 'room');
  }
  for (const feature of FEATURES) {
    if (values[feature]) params.set(feature, 'true');
  }
  const parsed = parseFilters(params);
  return {
    price_min: parsed.price_min,
    price_max: parsed.price_max,
    rooms_min: parsed.rooms_min,
    rooms_max: parsed.rooms_max,
    available_by: parsed.available_by,
    listing_type: parsed.listing_type,
    pets: parsed.pets,
    furnished: parsed.furnished,
    elevator: parsed.elevator,
    parking: parsed.parking,
  };
}

const legend = 'mb-2 text-sm font-bold';
const label = 'text-sm font-bold';
const box =
  'flex min-h-[48px] items-center gap-[6px] rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-3 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-tint has-[[aria-invalid=true]]:border-[#B91C1C]';
const bare =
  'min-h-[44px] min-w-0 flex-1 self-stretch border-0 bg-transparent text-start text-base font-semibold text-ink outline-none';
const control =
  'min-h-[48px] w-full rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-3 text-start text-base font-semibold text-ink focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-tint aria-[invalid=true]:border-[#B91C1C]';
const fieldError = 'text-sm font-semibold text-[#B91C1C]';
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** The filters panel of SearchDesktop.dc.html, in a single column. Validates on submit only. */
export function FiltersForm({ filters, onApply, onClear }: Props) {
  const { t } = useTranslation();
  const formId = useId();
  const [values, setValues] = useState<Values>(() => initialValues(filters));
  const [errors, setErrors] = useState<Errors>({});

  const fieldId = (name: keyof Values) => `${formId}-${name}`;
  const errorId = (name: ErrorField) => `${fieldId(name)}-error`;
  const set = (patch: Partial<Values>) => setValues((current) => ({ ...current, ...patch }));

  const a11y = (name: ErrorField | 'rooms_min') => {
    const invalid = name !== 'rooms_min' && errors[name] !== undefined;
    return {
      id: fieldId(name),
      'aria-invalid': invalid,
      'aria-describedby': invalid ? errorId(name) : undefined,
    };
  };

  const errorText = (name: ErrorField): ReactNode => {
    const error = errors[name];
    if (error === undefined) return null;
    const { key, ...params } = error;
    return (
      <p id={errorId(name)} role="alert" className={fieldError}>
        {t(key, params)}
      </p>
    );
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const found = validate(values);
    setErrors(found);
    const first = (['price_min', 'price_max', 'rooms_max'] as const).find(
      (name) => found[name] !== undefined,
    );
    if (first !== undefined) {
      document.getElementById(fieldId(first))?.focus();
      return;
    }
    onApply(toFilters(values));
  }

  function clear() {
    // The URL change remounts the form; when the URL is already clean, reset the edits here.
    setValues(EMPTY);
    setErrors({});
    onClear();
  }

  const priceInput = (name: 'price_min' | 'price_max', text: string) => (
    <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
      <div className={box}>
        <label htmlFor={fieldId(name)} className="shrink-0 text-sm text-muted">
          {text}
        </label>
        <input
          {...a11y(name)}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={values[name]}
          onChange={(e) => set({ [name]: e.target.value.replace(/\D/g, '') })}
          className={bare}
        />
        <span className="shrink-0 text-sm text-muted">{t('listings.units.ils')}</span>
      </div>
      {errorText(name)}
    </div>
  );

  const roomsSelect = (name: 'rooms_min' | 'rooms_max', text: string) => (
    <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
      <label htmlFor={fieldId(name)} className="text-sm text-muted">
        {text}
      </label>
      <select
        {...a11y(name)}
        value={values[name]}
        onChange={(e) => set({ [name]: e.target.value })}
        className={control}
      >
        <option value="">{t('search.any')}</option>
        {ROOM_OPTIONS.map((rooms) => (
          <option key={rooms} value={String(rooms)}>
            {formatRooms(rooms)}
          </option>
        ))}
      </select>
      {name === 'rooms_max' && errorText(name)}
    </div>
  );

  // The only box still on cannot be turned off; the hint says why.
  const oneType = values.apartment !== values.room;
  const typeHintId = `${fieldId('room')}-type-hint`;
  const typeBox = (name: 'apartment' | 'room', text: string) => (
    <label className="flex min-h-[44px] cursor-pointer items-center gap-[10px] text-[14px] has-[:disabled]:cursor-default">
      <input
        id={fieldId(name)}
        type="checkbox"
        checked={values[name]}
        disabled={oneType && values[name]}
        aria-describedby={oneType ? typeHintId : undefined}
        onChange={(e) => set({ [name]: e.target.checked })}
        className={`h-[18px] w-[18px] shrink-0 accent-accent ${focusRing}`}
      />
      {text}
    </label>
  );

  const featureLabels: Record<Feature, string> = {
    pets: t('search.feature.pets'),
    furnished: t('search.feature.furnished'),
    elevator: t('search.feature.elevator'),
    parking: t('search.feature.parking'),
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-[22px] rounded-2xl border border-line bg-white p-4"
    >
      <fieldset className="min-w-0">
        <legend className={legend}>{t('search.type.legend')}</legend>
        <div className="flex flex-col">
          {typeBox('apartment', t('search.type.apartment'))}
          {typeBox('room', t('search.type.room'))}
        </div>
        {oneType && (
          <p id={typeHintId} className="text-xs text-muted">
            {t('search.type.hint')}
          </p>
        )}
      </fieldset>

      <fieldset className="min-w-0">
        <legend className={legend}>{t('search.price')}</legend>
        <div className="flex gap-2">
          {priceInput('price_min', t('search.from'))}
          {priceInput('price_max', t('search.to'))}
        </div>
      </fieldset>

      <fieldset className="min-w-0">
        <legend className={legend}>{t('search.rooms')}</legend>
        <div className="flex gap-2">
          {roomsSelect('rooms_min', t('search.from'))}
          {roomsSelect('rooms_max', t('search.to'))}
        </div>
      </fieldset>

      <div className="flex flex-col gap-[6px]">
        <label htmlFor={fieldId('available_by')} className={label}>
          {t('search.availableBy')}
        </label>
        <input
          id={fieldId('available_by')}
          type="date"
          value={values.available_by}
          aria-describedby={withReadback(
            `${fieldId('available_by')}-hint`,
            `${fieldId('available_by')}-chosen`,
            values.available_by,
          )}
          onChange={(e) => set({ available_by: e.target.value })}
          className={control}
        />
        <DateReadback id={`${fieldId('available_by')}-chosen`} value={values.available_by} />
        <p id={`${fieldId('available_by')}-hint`} className="text-xs text-muted">
          {t('search.availableByHint')}
        </p>
      </div>

      <fieldset className="min-w-0">
        <legend className={legend}>{t('search.features')}</legend>
        <div className="flex flex-wrap gap-2">
          {FEATURES.map((feature) => (
            <div key={feature} className="flex">
              <input
                id={fieldId(feature)}
                type="checkbox"
                checked={values[feature]}
                onChange={(e) => set({ [feature]: e.target.checked })}
                className="peer sr-only"
              />
              <label
                htmlFor={fieldId(feature)}
                className="flex min-h-[44px] cursor-pointer items-center rounded-full border-[1.5px] border-[#D6D3D1] bg-white px-[14px] text-[14px] font-medium peer-checked:border-accent peer-checked:bg-accent-tint peer-checked:font-semibold peer-checked:text-accent-text peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
              >
                {featureLabels[feature]}
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-3">
        <button
          type="submit"
          className={`flex min-h-[48px] flex-[1.6] items-center justify-center rounded-[14px] bg-accent px-4 text-base font-bold text-white ${focusRing}`}
        >
          {t('search.apply')}
        </button>
        <button
          type="button"
          onClick={clear}
          className={`flex min-h-[48px] flex-1 items-center justify-center rounded-[14px] border-[1.5px] border-[#D6D3D1] bg-white px-4 text-[15px] font-bold ${focusRing}`}
        >
          {t('search.clear')}
        </button>
      </div>
    </form>
  );
}
