import type { UseQueryResult } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AreaOut } from '../../api/client';
import { ChoiceGroup } from '../../components/ChoiceGroup';
import { DateReadback, withReadback } from '../../components/DateReadback';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Switch } from '../../components/Switch';
import { addDays, formatIls, formatRooms } from './format';
import { furnishedLabel } from './furnished';
import {
  AVAILABLE_FROM_MAX_DAYS,
  LIMITS,
  visibleLength,
  type FieldError,
  type FieldErrors,
  type FieldName,
  type ListingForm,
} from './validate';

const label = 'text-sm font-bold';
const box =
  'flex min-h-[48px] items-center gap-[6px] rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-3 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-tint has-[[aria-invalid=true]]:border-[#B91C1C]';
const bare =
  'min-h-[44px] min-w-0 flex-1 self-stretch border-0 bg-transparent text-start text-base font-semibold text-ink outline-none';
const input =
  'min-h-[48px] w-full rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-3 text-start text-base font-semibold text-ink focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-tint aria-[invalid=true]:border-[#B91C1C]';
const suffix = 'shrink-0 text-sm text-muted';
const hint = 'text-xs text-muted';
const fieldError = 'text-sm font-semibold text-[#B91C1C]';
const card = 'flex flex-col divide-y divide-[#F0EEEB] rounded-2xl border border-line bg-white';

// 1 … 10 rooms in half steps (the API allows up to 20; the select offers the common range).
const ROOM_OPTIONS = Array.from({ length: 19 }, (_, i) => 1 + i / 2);
const PARKING_OPTIONS = [0, 1, 2, 3, 4, 5];

type Props = {
  form: ListingForm;
  onChange: (patch: Partial<ListingForm>) => void;
  errors: FieldErrors;
  /** `GET /areas`, shared with the wizard (which derives the selected area from it). */
  areas: UseQueryResult<AreaOut[]>;
  /** Israel's calendar day, `YYYY-MM-DD`. */
  today: string;
  /** Element id of a field's input; the wizard focuses the first invalid one by id. */
  fieldId: (name: FieldName) => string;
};

/** Step 2: the listing's facts, in CreateListing.dc.html's order. */
export function DetailsStep({ form, onChange, errors, areas, today, fieldId }: Props) {
  const { t } = useTranslation();
  // The price shows `7,200` at rest and the bare digits while focused. The swap re-renders the
  // value, which drops the select-all a browser gives a field entered by Tab, so typing would
  // append ("72009"): re-select it, unless a pointer put the caret there.
  const [priceFocused, setPriceFocused] = useState(false);
  const priceRef = useRef<HTMLInputElement>(null);
  const pricePointer = useRef(false);
  useLayoutEffect(() => {
    if (priceFocused && !pricePointer.current) priceRef.current?.select();
    pricePointer.current = false;
  }, [priceFocused]);

  const errorId = (name: FieldName) => `${fieldId(name)}-error`;
  const hintId = (name: FieldName) => `${fieldId(name)}-hint`;
  const describedBy = (name: FieldName, withHint = false) =>
    [withHint ? hintId(name) : null, errors[name] ? errorId(name) : null]
      .filter((x) => x !== null)
      .join(' ') || undefined;
  const a11y = (name: FieldName, withHint = false) => ({
    id: fieldId(name),
    'aria-invalid': errors[name] !== undefined,
    'aria-describedby': describedBy(name, withHint),
  });

  function message(error: FieldError): string {
    const { key, ...params } = error;
    return t(key, params);
  }
  const errorText = (name: FieldName): ReactNode => {
    const error = errors[name];
    if (error === undefined) return null;
    return (
      <p id={errorId(name)} role="alert" className={fieldError}>
        {message(error)}
      </p>
    );
  };

  let areaControl: ReactNode;
  if (areas.isPending) {
    areaControl = (
      <select {...a11y('area_id')} disabled className={`${input} disabled:opacity-60`}>
        <option>{t('common.loading')}</option>
      </select>
    );
  } else if (areas.isError) {
    areaControl = <ErrorState onRetry={() => void areas.refetch()} />;
  } else if (areas.data.length === 0) {
    areaControl = <EmptyState message={t('areas.empty')} />;
  } else {
    areaControl = (
      <select
        {...a11y('area_id')}
        value={form.area_id}
        onChange={(e) => onChange({ area_id: e.target.value })}
        className={input}
      >
        {areas.data.length > 1 && <option value="">{t('listings.fields.choose')}</option>}
        {areas.data.map((area) => (
          <option key={area.id} value={area.id}>
            {area.name_he}
          </option>
        ))}
      </select>
    );
  }
  const areaHasSelect = areas.isPending || (areas.isSuccess && areas.data.length > 0);

  const textField = (name: 'city' | 'street', fieldLabel: string, withHint = false) => (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={fieldId(name)} className={label}>
        {fieldLabel}
      </label>
      <input
        {...a11y(name, withHint)}
        type="text"
        value={form[name]}
        onChange={(e) => onChange({ [name]: e.target.value })}
        className={input}
      />
      {withHint && (
        <p id={hintId(name)} className={hint}>
          {t('listings.fields.streetHint')}
        </p>
      )}
      {errorText(name)}
    </div>
  );

  const moneyField = (name: 'arnona_ils' | 'vaad_ils', fieldLabel: string) => (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={fieldId(name)} className={label}>
        {fieldLabel}
      </label>
      <div className={box}>
        <input
          {...a11y(name, true)}
          type="number"
          inputMode="numeric"
          min={LIMITS[name].min}
          max={LIMITS[name].max}
          value={form[name]}
          onChange={(e) => onChange({ [name]: e.target.value })}
          className={bare}
        />
        <span className={suffix}>{t('listings.units.ils')}</span>
      </div>
      <p id={hintId(name)} className={hint}>
        {t('listings.fields.optional')}
      </p>
      {errorText(name)}
    </div>
  );

  const charsLeft = Math.max(
    0,
    LIMITS.description - visibleLength(form.description, { multiline: true }),
  );

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-[6px]">
        {areaHasSelect ? (
          <label htmlFor={fieldId('area_id')} className={label}>
            {t('listings.fields.area')}
          </label>
        ) : (
          <p className={label}>{t('listings.fields.area')}</p>
        )}
        {areaControl}
        {errorText('area_id')}
      </div>

      {textField('city', t('listings.fields.city'))}
      {textField('street', t('listings.fields.street'), true)}

      <div className="flex flex-col gap-[6px]">
        <label htmlFor={fieldId('rooms')} className={label}>
          {t('listings.fields.rooms')}
        </label>
        <select
          {...a11y('rooms')}
          value={form.rooms}
          onChange={(e) => onChange({ rooms: e.target.value })}
          className={input}
        >
          <option value="">{t('listings.fields.choose')}</option>
          {form.rooms !== '' && !ROOM_OPTIONS.map(String).includes(form.rooms) && (
            <option value={form.rooms}>{formatRooms(Number(form.rooms))}</option>
          )}
          {ROOM_OPTIONS.map((rooms) => (
            <option key={rooms} value={String(rooms)}>
              {formatRooms(rooms)}
            </option>
          ))}
        </select>
        {errorText('rooms')}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-[6px]">
          <label htmlFor={fieldId('floor')} className={label}>
            {t('listings.fields.floor')}
          </label>
          <div className={box}>
            <input
              {...a11y('floor')}
              type="number"
              min={LIMITS.floor.min}
              max={LIMITS.floor.max}
              value={form.floor}
              onChange={(e) => onChange({ floor: e.target.value })}
              className={bare}
            />
            <span aria-hidden="true" className={suffix}>
              {t('listings.fields.of')}
            </span>
            <input
              {...a11y('total_floors')}
              aria-label={t('listings.fields.totalFloors')}
              type="number"
              min={LIMITS.floor.min}
              max={LIMITS.floor.max}
              value={form.total_floors}
              onChange={(e) => onChange({ total_floors: e.target.value })}
              className={`${bare} max-w-[3.5rem] text-center`}
            />
          </div>
          {errorText('floor')}
          {errorText('total_floors')}
        </div>
        <div className="flex min-w-0 flex-col gap-[6px]">
          <label htmlFor={fieldId('size_sqm')} className={label}>
            {t('listings.fields.size')}
          </label>
          <div className={box}>
            <input
              {...a11y('size_sqm')}
              type="number"
              inputMode="numeric"
              min={LIMITS.size_sqm.min}
              max={LIMITS.size_sqm.max}
              value={form.size_sqm}
              onChange={(e) => onChange({ size_sqm: e.target.value })}
              className={bare}
            />
            <span className={suffix}>{t('listings.units.sqm')}</span>
          </div>
          {errorText('size_sqm')}
        </div>
      </div>

      <div className="flex flex-col gap-[6px]">
        <label htmlFor={fieldId('price_ils')} className={label}>
          {t('listings.fields.price')}
        </label>
        <div className={`${box} min-h-[52px]`}>
          <input
            {...a11y('price_ils')}
            ref={priceRef}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={
              priceFocused || form.price_ils === ''
                ? form.price_ils
                : formatIls(Number(form.price_ils))
            }
            onPointerDown={() => {
              pricePointer.current = true;
            }}
            onFocus={() => setPriceFocused(true)}
            onBlur={() => setPriceFocused(false)}
            onChange={(e) => onChange({ price_ils: e.target.value.replace(/\D/g, '') })}
            className={`${bare} text-xl font-extrabold`}
          />
          <span className={`${suffix} text-base font-semibold`}>{t('listings.units.ils')}</span>
        </div>
        {errorText('price_ils')}
      </div>

      <div className="flex flex-col gap-[6px]">
        <label htmlFor={fieldId('available_from')} className={label}>
          {t('listings.fields.availableFrom')}
        </label>
        <input
          {...a11y('available_from')}
          aria-describedby={withReadback(
            a11y('available_from')['aria-describedby'],
            `${fieldId('available_from')}-chosen`,
            form.available_from,
          )}
          type="date"
          min={today}
          max={addDays(today, AVAILABLE_FROM_MAX_DAYS)}
          value={form.available_from}
          onChange={(e) => onChange({ available_from: e.target.value })}
          className={input}
        />
        <DateReadback id={`${fieldId('available_from')}-chosen`} value={form.available_from} />
        {errorText('available_from')}
      </div>

      <div className={card}>
        <Switch
          label={t('listings.fields.entryFlexible')}
          checked={form.entry_flexible}
          onChange={(entry_flexible) => onChange({ entry_flexible })}
        />
        <Switch
          label={t('listings.fields.elevator')}
          checked={form.elevator}
          onChange={(elevator) => onChange({ elevator })}
        />
      </div>

      <div className="flex flex-col gap-[6px]">
        <label htmlFor={fieldId('parking_spots')} className={label}>
          {t('listings.fields.parking')}
        </label>
        <select
          {...a11y('parking_spots')}
          value={form.parking_spots}
          onChange={(e) => onChange({ parking_spots: e.target.value })}
          className={input}
        >
          {PARKING_OPTIONS.map((spots) => (
            <option key={spots} value={String(spots)}>
              {spots}
            </option>
          ))}
        </select>
        {errorText('parking_spots')}
      </div>

      <ChoiceGroup
        legend={t('listings.fields.furnished')}
        name="furnished"
        options={(['none', 'partial', 'full'] as const).map((value) => ({
          value,
          label: furnishedLabel(t, value, form.listing_type),
        }))}
        value={form.furnished}
        onChange={(furnished) => onChange({ furnished })}
      />

      <div className={card}>
        <Switch
          label={t('listings.fields.pets')}
          checked={form.pets_allowed}
          onChange={(pets_allowed) => onChange({ pets_allowed })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {moneyField('arnona_ils', t('listings.fields.arnona'))}
        {moneyField('vaad_ils', t('listings.fields.vaad'))}
      </div>

      <div className="flex flex-col gap-[6px]">
        <label htmlFor={fieldId('description')} className={label}>
          {t('listings.fields.description')}
        </label>
        <textarea
          {...a11y('description', true)}
          rows={5}
          value={form.description}
          onChange={(e) => onChange({ description: e.target.value })}
          className={`${input} py-3 font-normal`}
        />
        <p id={hintId('description')} className={hint}>
          {t('listings.fields.charsLeft', { count: charsLeft })}
        </p>
        {errorText('description')}
      </div>
    </div>
  );
}
