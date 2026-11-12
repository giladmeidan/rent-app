import type { UseQueryResult } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { AreaOut } from '../../api/client';
import { Card } from '../../components/Card';
import { ChoiceGroup } from '../../components/ChoiceGroup';
import { cx } from '../../components/cx';
import { DateReadback, withReadback } from '../../components/DateReadback';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Field, useField } from '../../components/Field';
import { Select } from '../../components/Select';
import { Switch } from '../../components/Switch';
import { Textarea } from '../../components/Textarea';
import { TextInput } from '../../components/TextInput';
import { addDays, formatIls, formatRooms } from './format';
import { furnishedLabel } from './furnished';
import {
  AVAILABLE_FROM_MAX_DAYS,
  LIMITS,
  visibleLength,
  type FieldErrors,
  type FieldName,
  type ListingForm,
} from './validate';

const groupHeading = 'text-h3';
const alertText = 'text-body-sm font-medium text-danger';

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

type FloorBoxProps = {
  floor: string;
  total: string;
  onFloor: (value: string) => void;
  onTotal: (value: string) => void;
  totalLabel: string;
  of: string;
  /** Either floor error reddens the one box. */
  invalid: boolean;
  totalId: string;
  totalInvalid: boolean;
  totalDescribedBy: string | undefined;
};

/** The floor field's control: two inputs in one box, "3 מתוך 5". The floor input takes the
 * surrounding `Field`'s id and wiring; the total input has its own. */
function FloorBox({
  floor,
  total,
  onFloor,
  onTotal,
  totalLabel,
  of,
  invalid,
  totalId,
  totalInvalid,
  totalDescribedBy,
}: FloorBoxProps) {
  const field = useField();
  return (
    <div
      className={cx(
        'flex items-center gap-1.5 rounded-md border bg-surface px-3 text-ink-muted focus-within:ring-2 focus-within:ring-accent-soft',
        invalid ? 'border-danger' : 'border-border-strong focus-within:border-accent',
      )}
    >
      <input
        id={field?.id}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid === true ? true : undefined}
        type="number"
        min={LIMITS.floor.min}
        max={LIMITS.floor.max}
        value={floor}
        onChange={(e) => onFloor(e.target.value)}
        className="min-h-tap min-w-0 flex-1 self-stretch bg-transparent text-body text-ink outline-none"
      />
      <span aria-hidden="true" className="shrink-0 text-body-sm text-ink-muted">
        {of}
      </span>
      <input
        id={totalId}
        aria-label={totalLabel}
        aria-invalid={totalInvalid ? true : undefined}
        aria-describedby={totalDescribedBy}
        type="number"
        min={LIMITS.floor.min}
        max={LIMITS.floor.max}
        value={total}
        onChange={(e) => onTotal(e.target.value)}
        className="min-h-tap w-9 self-stretch bg-transparent text-center text-body text-ink outline-none"
      />
    </div>
  );
}

/** Step 2: the listing's facts, in CreateListing.dc.html's order, in titled groups. */
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
  const message = (name: FieldName): string | undefined => {
    const error = errors[name];
    if (error === undefined) return undefined;
    const { key, ...params } = error;
    return t(key, params);
  };

  let areaControl: ReactNode;
  if (areas.isPending) {
    areaControl = (
      <Field id={fieldId('area_id')} label={t('listings.fields.area')} error={message('area_id')}>
        <Select disabled>
          <option>{t('common.loading')}</option>
        </Select>
      </Field>
    );
  } else if (areas.isError || areas.data.length === 0) {
    // No control to wire: a label, the state, and today's alert.
    areaControl = (
      <>
        <p className="text-label">{t('listings.fields.area')}</p>
        {areas.isError ? (
          <ErrorState onRetry={() => void areas.refetch()} />
        ) : (
          <EmptyState message={t('areas.empty')} />
        )}
        {errors.area_id !== undefined && (
          <p id={errorId('area_id')} role="alert" className={alertText}>
            {message('area_id')}
          </p>
        )}
      </>
    );
  } else {
    areaControl = (
      <Field id={fieldId('area_id')} label={t('listings.fields.area')} error={message('area_id')}>
        <Select value={form.area_id} onChange={(e) => onChange({ area_id: e.target.value })}>
          {areas.data.length > 1 && <option value="">{t('listings.fields.choose')}</option>}
          {areas.data.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name_he}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  const moneyField = (name: 'arnona_ils' | 'vaad_ils', fieldLabel: string) => (
    <Field
      id={fieldId(name)}
      label={fieldLabel}
      hint={t('listings.fields.optional')}
      error={message(name)}
    >
      <TextInput
        type="number"
        inputMode="numeric"
        min={LIMITS[name].min}
        max={LIMITS[name].max}
        value={form[name]}
        onChange={(e) => onChange({ [name]: e.target.value })}
        end={t('listings.units.ils')}
      />
    </Field>
  );

  const charsLeft = Math.max(
    0,
    LIMITS.description - visibleLength(form.description, { multiline: true }),
  );

  const totalError = errors.total_floors !== undefined;
  const parkingError = message('parking_spots');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h3 className={groupHeading}>{t('listings.section.address')}</h3>
        <div data-testid="area-field" className="flex flex-col gap-1.5">
          {areaControl}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field id={fieldId('city')} label={t('listings.fields.city')} error={message('city')}>
            <TextInput
              type="text"
              value={form.city}
              onChange={(e) => onChange({ city: e.target.value })}
            />
          </Field>
          <Field
            id={fieldId('street')}
            label={t('listings.fields.street')}
            hint={t('listings.fields.streetHint')}
            error={message('street')}
          >
            <TextInput
              type="text"
              value={form.street}
              onChange={(e) => onChange({ street: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className={groupHeading}>{t('listings.section.apartment')}</h3>
        <Field id={fieldId('rooms')} label={t('listings.fields.rooms')} error={message('rooms')}>
          <Select value={form.rooms} onChange={(e) => onChange({ rooms: e.target.value })}>
            <option value="">{t('listings.fields.choose')}</option>
            {form.rooms !== '' && !ROOM_OPTIONS.map(String).includes(form.rooms) && (
              <option value={form.rooms}>{formatRooms(Number(form.rooms))}</option>
            )}
            {ROOM_OPTIONS.map((rooms) => (
              <option key={rooms} value={String(rooms)}>
                {formatRooms(rooms)}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Field
              id={fieldId('floor')}
              label={t('listings.fields.floor')}
              error={message('floor')}
            >
              <FloorBox
                floor={form.floor}
                total={form.total_floors}
                onFloor={(floor) => onChange({ floor })}
                onTotal={(total_floors) => onChange({ total_floors })}
                totalLabel={t('listings.fields.totalFloors')}
                of={t('listings.fields.of')}
                invalid={errors.floor !== undefined || totalError}
                totalId={fieldId('total_floors')}
                totalInvalid={totalError}
                totalDescribedBy={totalError ? errorId('total_floors') : undefined}
              />
            </Field>
            {totalError && (
              <p id={errorId('total_floors')} role="alert" className={alertText}>
                {message('total_floors')}
              </p>
            )}
          </div>
          <Field
            id={fieldId('size_sqm')}
            label={t('listings.fields.size')}
            error={message('size_sqm')}
          >
            <TextInput
              type="number"
              inputMode="numeric"
              min={LIMITS.size_sqm.min}
              max={LIMITS.size_sqm.max}
              value={form.size_sqm}
              onChange={(e) => onChange({ size_sqm: e.target.value })}
              end={t('listings.units.sqm')}
            />
          </Field>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className={groupHeading}>{t('listings.section.priceEntry')}</h3>
        <Field
          id={fieldId('price_ils')}
          label={t('listings.fields.price')}
          error={message('price_ils')}
        >
          <TextInput
            ref={priceRef}
            size="lg"
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
            end={<span className="text-body font-medium">{t('listings.units.ils')}</span>}
          />
        </Field>

        <Field
          id={fieldId('available_from')}
          label={t('listings.fields.availableFrom')}
          error={message('available_from')}
        >
          <TextInput
            type="date"
            aria-describedby={withReadback(
              undefined,
              `${fieldId('available_from')}-chosen`,
              form.available_from,
            )}
            min={today}
            max={addDays(today, AVAILABLE_FROM_MAX_DAYS)}
            value={form.available_from}
            onChange={(e) => onChange({ available_from: e.target.value })}
          />
          <DateReadback id={`${fieldId('available_from')}-chosen`} value={form.available_from} />
        </Field>

        <Card padding="none">
          <Switch
            label={t('listings.fields.entryFlexible')}
            checked={form.entry_flexible}
            onChange={(entry_flexible) => onChange({ entry_flexible })}
          />
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className={groupHeading}>{t('listings.section.amenities')}</h3>
        <Card padding="none" className="flex flex-col divide-y divide-border">
          <Switch
            label={t('listings.fields.elevator')}
            checked={form.elevator}
            onChange={(elevator) => onChange({ elevator })}
          />
          <div>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <label htmlFor={fieldId('parking_spots')} className="text-body font-medium">
                {t('listings.fields.parking')}
              </label>
              <div className="w-24 shrink-0">
                <Select
                  id={fieldId('parking_spots')}
                  invalid={parkingError !== undefined}
                  aria-describedby={
                    parkingError !== undefined ? errorId('parking_spots') : undefined
                  }
                  value={form.parking_spots}
                  onChange={(e) => onChange({ parking_spots: e.target.value })}
                >
                  {PARKING_OPTIONS.map((spots) => (
                    <option key={spots} value={String(spots)}>
                      {spots}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {parkingError !== undefined && (
              <p id={errorId('parking_spots')} role="alert" className={cx(alertText, 'px-4 pb-3')}>
                {parkingError}
              </p>
            )}
          </div>
          <div className="px-4 py-3">
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
          </div>
          <Switch
            label={t('listings.fields.pets')}
            checked={form.pets_allowed}
            onChange={(pets_allowed) => onChange({ pets_allowed })}
          />
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <h3 className={groupHeading}>{t('listings.section.payments')}</h3>
        <div className="grid grid-cols-2 gap-3">
          {moneyField('arnona_ils', t('listings.fields.arnona'))}
          {moneyField('vaad_ils', t('listings.fields.vaad'))}
        </div>
      </div>

      <Field
        id={fieldId('description')}
        label={t('listings.fields.description')}
        hint={t('listings.fields.charsLeft', { count: charsLeft })}
        error={message('description')}
      >
        <Textarea
          rows={5}
          value={form.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>
    </div>
  );
}
