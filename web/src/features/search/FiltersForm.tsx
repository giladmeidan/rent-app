import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { DateReadback, withReadback } from '../../components/DateReadback';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { TextInput } from '../../components/TextInput';
import type { ListingType } from '../listings/api';
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

// `listing_type` is the page's side (spec 0010a), never a form field.
type FormKey = Exclude<keyof Filters, 'sort' | 'view' | 'listing_type'>;
/** Every filter the form owns, present (as `undefined` when unset) so it overrides the URL's. */
export type FormFilters = { [K in FormKey]: Filters[K] };

type Props = {
  /** The URL's filters; the form is remounted (keyed by the URL) whenever they change. */
  filters: Filters;
  onApply: (values: FormFilters) => void;
  onClear: () => void;
  /** The id of the panel's `<h2>`, so the page can name the panel's region after it. */
  titleId?: string;
  /** The page's side (spec 0010a): words the date hint for apartments or rooms. */
  type?: ListingType;
};

type Values = {
  price_min: string;
  price_max: string;
  rooms_min: string;
  rooms_max: string;
  available_by: string;
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
    pets: parsed.pets,
    furnished: parsed.furnished,
    elevator: parsed.elevator,
    parking: parsed.parking,
  };
}

const legend = 'mb-2 text-label';

/** The filters panel of SearchDesktop.dc.html, in a single column. Validates on submit only. */
export function FiltersForm({ filters, onApply, onClear, titleId, type = 'apartment' }: Props) {
  const { t } = useTranslation();
  const formId = useId();
  const [values, setValues] = useState<Values>(() => initialValues(filters));
  const [errors, setErrors] = useState<Errors>({});

  const fieldId = (name: keyof Values) => `${formId}-${name}`;
  const set = (patch: Partial<Values>) => setValues((current) => ({ ...current, ...patch }));

  const errorText = (name: ErrorField): string | undefined => {
    const error = errors[name];
    if (error === undefined) return undefined;
    const { key, ...params } = error;
    return t(key, params);
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
    <Field
      id={fieldId(name)}
      label={text}
      labelHidden
      error={errorText(name)}
      className="min-w-0 flex-1"
    >
      <TextInput
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={values[name]}
        onChange={(e) => set({ [name]: e.target.value.replace(/\D/g, '') })}
        start={<span aria-hidden="true">{text}</span>}
        end={t('listings.units.ils')}
      />
    </Field>
  );

  const roomsSelect = (name: 'rooms_min' | 'rooms_max', text: string) => (
    <Field
      id={fieldId(name)}
      label={text}
      error={name === 'rooms_max' ? errorText(name) : undefined}
      className="min-w-0 flex-1"
    >
      <Select value={values[name]} onChange={(e) => set({ [name]: e.target.value })}>
        <option value="">{t('search.any')}</option>
        {ROOM_OPTIONS.map((rooms) => (
          <option key={rooms} value={String(rooms)}>
            {formatRooms(rooms)}
          </option>
        ))}
      </Select>
    </Field>
  );

  const featureLabels: Record<Feature, string> = {
    pets: t('search.feature.pets'),
    furnished: t('search.feature.furnished'),
    elevator: t('search.feature.elevator'),
    parking: t('search.feature.parking'),
  };

  const dateId = fieldId('available_by');
  const chosenId = `${dateId}-chosen`;

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <h2 id={titleId} className="sr-only text-h3 lg:not-sr-only">
        {t('search.filters')}
      </h2>

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

      <Field
        id={dateId}
        label={t('search.availableBy')}
        hint={type === 'room' ? t('market.availableByHint') : t('search.availableByHint')}
      >
        <TextInput
          type="date"
          value={values.available_by}
          aria-describedby={withReadback(undefined, chosenId, values.available_by)}
          onChange={(e) => set({ available_by: e.target.value })}
        />
        <DateReadback id={chosenId} value={values.available_by} />
      </Field>

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
                className="flex min-h-tap cursor-pointer items-center rounded-full border border-border-strong bg-surface px-3.5 text-label text-ink peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent-strong peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
              >
                {featureLabels[feature]}
              </label>
            </div>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-3">
        <Button type="submit" variant="primary" size="md" className="grow whitespace-nowrap">
          {t('search.apply')}
        </Button>
        <Button type="button" variant="secondary" size="md" onClick={clear} className="flex-1">
          {t('search.clear')}
        </Button>
      </div>
    </form>
  );
}
