import type { TFunction } from 'i18next';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { ChoiceGroup, type ChoiceOption } from '../../components/ChoiceGroup';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { TextInput } from '../../components/TextInput';
import { LifestyleFields } from '../lifestyle/LifestyleFields';
import type { GenderPreference, Poster } from './api';
import { GENDER_PREFERENCES, POSTERS } from './constants';
import {
  firstInvalidAge,
  flatmateAgeError,
  LIMITS,
  roomSizeMax,
  type FieldErrors,
  type FieldName,
  type ListingForm,
  type YesNo,
} from './validate';

const alertText = 'text-body-sm font-medium text-danger';

/** 1 … 7 flatmates (the API's range). */
const COUNT_OPTIONS = Array.from(
  { length: LIMITS.flatmates_count.max - LIMITS.flatmates_count.min + 1 },
  (_, i) => LIMITS.flatmates_count.min + i,
);

/** "נשים" / "גברים" / "לא משנה" (0007d's keys), shared with the wizard's preview. Static keys, so
 * `i18n-check` verifies each one. */
export function useGenderPreferenceLabels(): Record<GenderPreference, string> {
  const { t } = useTranslation();
  return {
    women: t('rooms.genderPreference.women'),
    men: t('rooms.genderPreference.men'),
    any: t('rooms.genderPreference.any'),
  };
}

type Props = {
  form: ListingForm;
  onChange: (patch: Partial<ListingForm>) => void;
  errors: FieldErrors;
  /** Element id of a field's input; the wizard focuses the first invalid one by id. */
  fieldId: (name: FieldName) => string;
};

/** The flat facts' yes / no / "לא לציין" choices (0010f), in display order; an apartment's facts
 * (0014b) use them too. */
const YES_NO: readonly YesNo[] = ['yes', 'no', ''];

export function yesNoOptions(t: TFunction): ChoiceOption<YesNo>[] {
  const labels: Record<YesNo, string> = {
    yes: t('common.yes'),
    no: t('common.no'),
    '': t('listings.room.unset'),
  };
  return YES_NO.map((value) => ({ value, label: labels[value] }));
}

/**
 * Step 3's room block (spec 0007e): who the room is for, how many flatmates live there, their ages
 * (optional), the flat facts (0010f, all optional: the room's size, a private bathroom, a balcony,
 * bills, who is posting) and the flat's questionnaire (optional). Rendered for a room only.
 */
export function RoomFields({ form, onChange, errors, fieldId }: Props) {
  const { t } = useTranslation();
  const headingId = useId();
  const genders = useGenderPreferenceLabels();

  const errorId = (name: FieldName) => `${fieldId(name)}-error`;
  const hintId = (name: FieldName) => `${fieldId(name)}-hint`;
  const describedBy = (name: FieldName, withHint = false) =>
    [withHint ? hintId(name) : null, errors[name] ? errorId(name) : null]
      .filter((x) => x !== null)
      .join(' ') || undefined;

  const message = (name: FieldName): string | undefined => {
    const error = errors[name];
    if (error === undefined) return undefined;
    const { key, ...params } = error;
    return t(key, params);
  };

  const genderOptions: ChoiceOption<GenderPreference>[] = GENDER_PREFERENCES.map((value) => ({
    value,
    label: genders[value],
  }));
  const yesNo = yesNoOptions(t);
  const posterOptions: ChoiceOption<Poster | ''>[] = [
    // `i18n-check` does not see these dynamic keys; `rooms/__tests__/poster.test.ts` covers them.
    ...POSTERS.map((value) => ({ value, label: t(`listings.room.poster.${value}`) })),
    { value: '' as const, label: t('listings.room.unset') },
  ];
  const yesNoFacts = [
    { name: 'private_bathroom', legend: t('listings.room.privateBathroom') },
    { name: 'balcony', legend: t('listings.room.balcony') },
    { name: 'bills_included', legend: t('listings.room.bills') },
  ] as const;

  const count = form.flatmates_count;
  const ages = form.flatmate_ages;
  const agesInvalid = errors.flatmate_ages !== undefined;
  // The slot the wizard focuses: the first invalid one, else the first. From the values, not the
  // shown error: "next" focuses by id before the error renders.
  const target = firstInvalidAge(form) ?? 0;
  const slotId = (i: number) =>
    i === target ? fieldId('flatmate_ages') : `${fieldId('flatmate_ages')}-${String(i)}`;

  function setAge(i: number, value: string) {
    // No holes: typing into slot 3 first gives ['', '', value].
    onChange({
      flatmate_ages: Array.from({ length: Math.max(ages.length, i + 1) }, (_, j) =>
        j === i ? value : (ages[j] ?? ''),
      ),
    });
  }

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 border-t border-border pt-6"
    >
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="text-h3">
          {t('listings.room.title')}
        </h3>
        {/* PRODUCT.md "Rooms" → room privacy: ages and answers reach signed-in seekers only. */}
        <p className="text-body-sm text-ink-muted">{t('listings.room.privacyNote')}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <ChoiceGroup
          legend={t('listings.room.genderPreference')}
          name="gender_preference"
          options={genderOptions}
          value={form.gender_preference}
          onChange={(gender_preference) => onChange({ gender_preference })}
        />
        <p className="text-caption text-ink-muted">{t('listings.room.genderHint')}</p>
      </div>

      <Field
        id={fieldId('flatmates_count')}
        label={t('listings.room.flatmatesCount')}
        hint={t('listings.room.flatmatesHint')}
        error={message('flatmates_count')}
      >
        <Select
          value={String(count ?? '')}
          onChange={(e) =>
            onChange({
              flatmates_count: COUNT_OPTIONS.find((n) => String(n) === e.target.value) ?? null,
            })
          }
        >
          <option value="">{t('listings.fields.choose')}</option>
          {COUNT_OPTIONS.map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </Select>
      </Field>

      {count !== null && (
        <fieldset
          aria-invalid={agesInvalid}
          aria-describedby={describedBy('flatmate_ages', true)}
          className="flex flex-col"
        >
          <legend className="mb-1 text-label text-ink">{t('listings.room.ages')}</legend>
          <p id={hintId('flatmate_ages')} className="text-caption text-ink-muted">
            {t('listings.room.agesHint')}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2 lg:grid-cols-4">
            {Array.from({ length: count }, (_, i) => {
              const value = ages[i] ?? '';
              const invalid = agesInvalid && flatmateAgeError(value) !== undefined;
              return (
                // The slots are positions: flatmate i + 1.
                <div key={`slot-${String(i)}`} className="flex min-w-0 flex-col gap-1">
                  <label htmlFor={slotId(i)} className="text-caption text-ink">
                    {t('listings.room.ageOf', { n: i + 1 })}
                  </label>
                  <TextInput
                    id={slotId(i)}
                    type="text"
                    inputMode="numeric"
                    value={value}
                    onChange={(e) => setAge(i, e.target.value)}
                    invalid={invalid}
                    aria-describedby={
                      invalid
                        ? `${hintId('flatmate_ages')} ${errorId('flatmate_ages')}`
                        : hintId('flatmate_ages')
                    }
                  />
                </div>
              );
            })}
          </div>
          {agesInvalid && (
            <p id={errorId('flatmate_ages')} role="alert" className={`mt-1.5 ${alertText}`}>
              {message('flatmate_ages')}
            </p>
          )}
        </fieldset>
      )}

      <Field
        id={fieldId('room_size_sqm')}
        label={t('listings.room.roomSize')}
        hint={t('listings.room.roomSizeHint')}
        error={message('room_size_sqm')}
      >
        <TextInput
          type="number"
          inputMode="numeric"
          min={LIMITS.room_size_sqm.min}
          max={roomSizeMax(form)}
          value={form.room_size_sqm}
          onChange={(e) => onChange({ room_size_sqm: e.target.value })}
          end={t('listings.units.sqm')}
        />
      </Field>

      {yesNoFacts.map((fact) => (
        <ChoiceGroup
          key={fact.name}
          legend={fact.legend}
          name={fact.name}
          options={yesNo}
          value={form[fact.name]}
          onChange={(value) => onChange({ [fact.name]: value })}
        />
      ))}

      <div className="flex flex-col gap-1.5">
        <ChoiceGroup
          legend={t('listings.room.poster.title')}
          name="poster"
          options={posterOptions}
          value={form.poster}
          onChange={(poster) => onChange({ poster })}
        />
        {form.poster === 'lives_here' && (
          <p className="text-caption text-ink-muted">{t('listings.room.poster.livesHereHint')}</p>
        )}
      </div>

      <div className="border-t border-border pt-6">
        <LifestyleFields
          perspective="flat"
          headingLevel={4}
          value={form.lifestyle}
          onChange={(lifestyle) => onChange({ lifestyle })}
        />
      </div>
    </section>
  );
}
