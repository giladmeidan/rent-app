import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { DateReadback, withReadback } from '../../components/DateReadback';
import { Field } from '../../components/Field';
import { TextInput } from '../../components/TextInput';
import type { ListingType } from '../listings/api';
import { formatRooms } from '../listings/format';
import { AreaFilterField } from './AreaFilterField';
import {
  FEATURES,
  PRICE_MAX,
  ROOM_CHIPS,
  parseFilters,
  roomChipsOn,
  toSearchParams,
  toggleRoomChip,
  type Feature,
  type Filters,
  type RoomChip,
} from './filters';
import { useFilterCount } from './useFilterCount';

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
  /** In the phone's full-screen sheet, which has its own title: no `<h2>`, and the buttons stay in
   * view at its bottom edge. */
  sheet?: boolean;
};

type Values = {
  area_ids: string[];
  price_min: string;
  price_max: string;
  rooms_min: number | undefined;
  rooms_max: number | undefined;
  available_by: string;
} & Record<Feature, boolean>;

type ErrorField = 'price_min' | 'price_max';
type FieldError =
  { key: 'listings.errors.range'; min: number; max: number } | { key: 'search.errors.priceOrder' };
type Errors = Partial<Record<ErrorField, FieldError>>;

const toText = (value: number | undefined) => (value === undefined ? '' : String(value));

function initialValues(filters: Filters): Values {
  return {
    area_ids: filters.area_ids ?? [],
    price_min: toText(filters.price_min),
    price_max: toText(filters.price_max),
    rooms_min: filters.rooms_min,
    rooms_max: filters.rooms_max,
    available_by: filters.available_by ?? '',
    pets: filters.pets === true,
    furnished: filters.furnished === true,
    elevator: filters.elevator === true,
    parking: filters.parking === true,
    shelter: filters.shelter === true,
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
  return errors;
}

/** Only the form's own filters of `filters`. */
function formFilters(filters: Filters): FormFilters {
  return {
    area_ids: filters.area_ids,
    price_min: filters.price_min,
    price_max: filters.price_max,
    rooms_min: filters.rooms_min,
    rooms_max: filters.rooms_max,
    available_by: filters.available_by,
    pets: filters.pets,
    furnished: filters.furnished,
    elevator: filters.elevator,
    parking: filters.parking,
    shelter: filters.shelter,
  };
}

/** Valid form values as filters, through the URL parser (so the form can only write what it reads). */
function toFilters(values: Values): FormFilters {
  const params = new URLSearchParams();
  for (const areaId of values.area_ids) params.append('area_ids', areaId);
  for (const key of ['price_min', 'price_max'] as const) {
    // `007` → `7`: the URL holds canonical numbers.
    if (values[key] !== '') params.set(key, String(Number(values[key])));
  }
  for (const key of ['rooms_min', 'rooms_max'] as const) {
    const rooms = values[key];
    if (rooms !== undefined) params.set(key, String(rooms));
  }
  if (values.available_by !== '') params.set('available_by', values.available_by);
  for (const feature of FEATURES) {
    if (values[feature]) params.set(feature, 'true');
  }
  return formFilters(parseFilters(params));
}

const legend = 'mb-2 text-label';

type PillProps = {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The label's direction, for text RTL would reorder. */
  dir?: 'ltr';
  children: ReactNode;
};

/** A checkbox drawn as a pill. */
function PillCheckbox({ id, checked, onChange, dir, children }: PillProps) {
  return (
    <div className="flex">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <label
        htmlFor={id}
        dir={dir}
        className="flex min-h-tap cursor-pointer items-center rounded-full border border-border-strong bg-surface px-3.5 text-label text-ink peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent-strong peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
      >
        {children}
      </label>
    </div>
  );
}

/** The filters panel of SearchDesktop.dc.html, in a single column. Validates on submit only. */
export function FiltersForm({
  filters,
  onApply,
  onClear,
  titleId,
  type = 'apartment',
  sheet = false,
}: Props) {
  const { t } = useTranslation();
  const formId = useId();
  const [values, setValues] = useState<Values>(() => initialValues(filters));
  const [errors, setErrors] = useState<Errors>({});
  const [areasOverLimit, setAreasOverLimit] = useState(false);

  const fieldId = (name: keyof Values) => `${formId}-${name}`;
  const set = (patch: Partial<Values>) => setValues((current) => ({ ...current, ...patch }));

  // The list view's live count: only for a valid draft that differs from what the URL already shows.
  const mapView = filters.view === 'map';
  const draft = toFilters(values);
  const edited =
    toSearchParams(draft).toString() !== toSearchParams(formFilters(filters)).toString();
  const countable = !mapView && edited && Object.keys(validate(values)).length === 0;
  const count = useFilterCount({ ...draft, listing_type: type }, countable);
  let countText: string | undefined;
  if (count === 0) countText = t('search.applyNone');
  else if (count !== undefined) countText = t('search.applyCount', { count });

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
    const first = (['price_min', 'price_max'] as const).find((name) => found[name] !== undefined);
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
    setAreasOverLimit(false);
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

  const featureLabels: Record<Feature, string> = {
    pets: t('search.feature.pets'),
    furnished: t('search.feature.furnished'),
    elevator: t('search.feature.elevator'),
    parking: t('search.feature.parking'),
    shelter: t('search.feature.shelter'),
  };

  const roomRange = { rooms_min: values.rooms_min, rooms_max: values.rooms_max };
  const roomsOn = roomChipsOn(roomRange);
  const roomChipId = (chip: RoomChip) => `${formId}-rooms-${String(chip)}`;

  const dateId = fieldId('available_by');
  const chosenId = `${dateId}-chosen`;

  return (
    <form noValidate onSubmit={submit} className={cx('flex flex-col gap-5', sheet && 'flex-1')}>
      {!sheet && (
        <h2 id={titleId} className="text-h3">
          {t('search.filters')}
        </h2>
      )}

      <AreaFilterField
        id={fieldId('area_ids')}
        areaIds={values.area_ids}
        overLimit={areasOverLimit}
        onChange={(areaIds) => {
          setAreasOverLimit(false);
          set({ area_ids: areaIds });
        }}
        onOverLimit={() => setAreasOverLimit(true)}
      />

      <fieldset className="min-w-0">
        <legend className={legend}>{t('search.price')}</legend>
        <div className="flex gap-2">
          {priceInput('price_min', t('search.from'))}
          {priceInput('price_max', t('search.to'))}
        </div>
      </fieldset>

      <fieldset className="min-w-0">
        <legend className={legend}>{t('search.rooms')}</legend>
        <div className="flex flex-wrap gap-2">
          {ROOM_CHIPS.map((chip) => (
            <PillCheckbox
              key={chip}
              id={roomChipId(chip)}
              checked={roomsOn.includes(chip)}
              onChange={() => set(toggleRoomChip(roomRange, chip))}
              dir={chip === 5 ? 'ltr' : undefined}
            >
              {chip === 5 ? t('search.roomsFivePlus') : formatRooms(chip)}
            </PillCheckbox>
          ))}
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
            <PillCheckbox
              key={feature}
              id={fieldId(feature)}
              checked={values[feature]}
              onChange={(checked) => set({ [feature]: checked })}
            >
              {featureLabels[feature]}
            </PillCheckbox>
          ))}
        </div>
      </fieldset>

      {/* The count for a screen reader; no `aria-live`, which marks the page's results count line. */}
      {!mapView && (
        <p role="status" className="sr-only">
          {countText}
        </p>
      )}

      <div
        className={cx(
          'flex flex-wrap gap-3',
          // Flush with the sheet's edges, over the fields that scroll under it.
          sheet &&
            'sticky bottom-0 -mx-6 -mb-6 mt-auto border-t border-border bg-surface px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        )}
      >
        <Button type="submit" variant="primary" size="md" className="grow whitespace-nowrap">
          {countText ?? t('search.apply')}
        </Button>
        <Button type="button" variant="secondary" size="md" onClick={clear} className="flex-1">
          {t('search.clear')}
        </Button>
      </div>
    </form>
  );
}
