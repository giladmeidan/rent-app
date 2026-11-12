import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ChoiceGroup, type ChoiceOption } from '../../components/ChoiceGroup';
import { LifestyleFields } from '../lifestyle/LifestyleFields';
import type { GenderPreference } from './api';
import { GENDER_PREFERENCES } from './constants';
import {
  firstInvalidAge,
  flatmateAgeError,
  LIMITS,
  type FieldError,
  type FieldErrors,
  type FieldName,
  type ListingForm,
} from './validate';

const label = 'text-sm font-bold';
const input =
  'min-h-[48px] w-full rounded-xl border-[1.5px] border-border-strong bg-surface px-3 text-start text-base font-semibold text-ink focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-soft aria-[invalid=true]:border-danger';
const hint = 'text-xs text-ink-muted';
const fieldError = 'text-sm font-semibold text-danger';

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

/**
 * Step 3's room block (spec 0007e): who the room is for, how many flatmates live there, their ages
 * (optional) and the flat's questionnaire (optional). Rendered for a room only.
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

  const genderOptions: ChoiceOption<GenderPreference>[] = GENDER_PREFERENCES.map((value) => ({
    value,
    label: genders[value],
  }));

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
      className="flex flex-col gap-[22px] border-t border-border pt-[22px]"
    >
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="text-start text-lg font-extrabold">
          {t('listings.room.title')}
        </h3>
        {/* PRODUCT.md "Rooms" → room privacy: ages and answers reach signed-in seekers only. */}
        <p className="text-start text-sm text-ink-muted">{t('listings.room.privacyNote')}</p>
      </div>

      <div className="flex flex-col gap-[6px]">
        <ChoiceGroup
          legend={t('listings.room.genderPreference')}
          name="gender_preference"
          options={genderOptions}
          value={form.gender_preference}
          onChange={(gender_preference) => onChange({ gender_preference })}
        />
        <p className="text-start text-sm text-ink-muted">{t('listings.room.genderHint')}</p>
      </div>

      <div className="flex flex-col gap-[6px]">
        <label htmlFor={fieldId('flatmates_count')} className={label}>
          {t('listings.room.flatmatesCount')}
        </label>
        <select
          {...a11y('flatmates_count', true)}
          value={String(count ?? '')}
          onChange={(e) =>
            onChange({
              flatmates_count: COUNT_OPTIONS.find((n) => String(n) === e.target.value) ?? null,
            })
          }
          className={input}
        >
          <option value="">{t('listings.fields.choose')}</option>
          {COUNT_OPTIONS.map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </select>
        <p id={hintId('flatmates_count')} className={hint}>
          {t('listings.room.flatmatesHint')}
        </p>
        {errorText('flatmates_count')}
      </div>

      {count !== null && (
        <fieldset
          aria-invalid={agesInvalid}
          aria-describedby={describedBy('flatmate_ages', true)}
          className="flex flex-col"
        >
          <legend className="mb-1 text-sm font-bold">{t('listings.room.ages')}</legend>
          <p id={hintId('flatmate_ages')} className={hint}>
            {t('listings.room.agesHint')}
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {Array.from({ length: count }, (_, i) => {
              const value = ages[i] ?? '';
              const invalid = agesInvalid && flatmateAgeError(value) !== undefined;
              return (
                // The slots are positions: flatmate i + 1.
                <div key={`slot-${String(i)}`} className="flex min-w-0 flex-col gap-1">
                  <label htmlFor={slotId(i)} className="text-xs font-semibold">
                    {t('listings.room.ageOf', { n: i + 1 })}
                  </label>
                  <input
                    id={slotId(i)}
                    type="text"
                    inputMode="numeric"
                    value={value}
                    onChange={(e) => setAge(i, e.target.value)}
                    aria-invalid={invalid}
                    aria-describedby={
                      invalid
                        ? `${hintId('flatmate_ages')} ${errorId('flatmate_ages')}`
                        : hintId('flatmate_ages')
                    }
                    className={input}
                  />
                </div>
              );
            })}
          </div>
          {agesInvalid && <div className="mt-[6px]">{errorText('flatmate_ages')}</div>}
        </fieldset>
      )}

      <div className="border-t border-border pt-[22px]">
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
