import { useTranslation } from 'react-i18next';

import { Card } from '../../components/Card';
import { cx } from '../../components/cx';
import { Field } from '../../components/Field';
import { Select } from '../../components/Select';
import { Switch } from '../../components/Switch';
import type { ContractMonths, Household } from './api';
import { HOUSEHOLDS } from './constants';
import { usePreferenceLabels } from './OwnerPreferences';
import { RoomFields } from './RoomFields';
import type { FieldErrors, FieldName, ListingForm } from './validate';

// The look of `ChoiceGroup`'s segment, for a checkbox (a fieldset's `aria-invalid` reddens it).
const segment = cx(
  'flex min-h-tap flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border-strong bg-surface px-3 text-center text-body font-medium text-ink',
  'peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:text-accent-strong',
  'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
  'group-aria-[invalid=true]:border-danger',
);

const CONTRACT_OPTIONS: readonly ContractMonths[] = [6, 12, 24, 36];

type Props = {
  form: ListingForm;
  onChange: (patch: Partial<ListingForm>) => void;
  errors: FieldErrors;
  /** Element id of a field's input; the wizard focuses the first invalid one by id. */
  fieldId: (name: FieldName) => string;
};

/** Step 3: who the listing suits (CreateListing.dc.html's "העדפות"); for a room also the room block
 * (0007e). The step's heading and hint are the wizard's. */
export function PreferencesStep({ form, onChange, errors, fieldId }: Props) {
  const { t } = useTranslation();
  const labels = usePreferenceLabels();

  const errorId = (name: FieldName) => `${fieldId(name)}-error`;
  const message = (name: FieldName): string | undefined => {
    const error = errors[name];
    if (error === undefined) return undefined;
    const { key, ...params } = error;
    return t(key, params);
  };

  function toggle(household: Household, checked: boolean) {
    const others = form.accepted_households.filter((h) => h !== household);
    onChange({ accepted_households: checked ? [...others, household] : others });
  }

  const householdsInvalid = errors.accepted_households !== undefined;
  const room = form.listing_type === 'room';

  return (
    <div className="flex flex-col gap-6">
      <fieldset
        aria-invalid={householdsInvalid}
        aria-describedby={householdsInvalid ? errorId('accepted_households') : undefined}
        className="group flex flex-col"
      >
        <legend className="mb-2 text-label text-ink">{t('listings.prefs.households')}</legend>
        <div className="grid grid-cols-2 gap-2">
          {HOUSEHOLDS.map((household, i) => {
            const id = `${fieldId('accepted_households')}${i === 0 ? '' : `-${household}`}`;
            const checked = form.accepted_households.includes(household);
            return (
              <div key={household} className="flex">
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => toggle(household, e.target.checked)}
                  className="peer sr-only"
                />
                <label htmlFor={id} className={segment}>
                  {checked && (
                    <svg
                      aria-hidden="true"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0"
                    >
                      <path d="M5 12l5 5 9-10" />
                    </svg>
                  )}
                  {labels.households[household]}
                </label>
              </div>
            );
          })}
        </div>
        {householdsInvalid && (
          <p
            id={errorId('accepted_households')}
            role="alert"
            className="mt-1.5 text-body-sm font-medium text-danger"
          >
            {message('accepted_households')}
          </p>
        )}
      </fieldset>

      <Card padding="none">
        <Switch
          label={t('listings.prefs.noSmokers')}
          checked={!form.smoking_allowed}
          onChange={(noSmokers) => onChange({ smoking_allowed: !noSmokers })}
        />
      </Card>

      <Field
        id={fieldId('min_contract_months')}
        label={t('listings.prefs.minContract')}
        error={message('min_contract_months')}
      >
        <Select
          value={String(form.min_contract_months ?? '')}
          onChange={(e) =>
            onChange({
              min_contract_months:
                CONTRACT_OPTIONS.find((months) => String(months) === e.target.value) ?? null,
            })
          }
        >
          <option value="">{t('listings.prefs.contract.none')}</option>
          {CONTRACT_OPTIONS.map((months) => (
            <option key={months} value={String(months)}>
              {labels.contract[months]}
            </option>
          ))}
        </Select>
      </Field>

      {room && <RoomFields form={form} onChange={onChange} errors={errors} fieldId={fieldId} />}
    </div>
  );
}
