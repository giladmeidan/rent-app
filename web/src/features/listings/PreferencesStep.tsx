import { useTranslation } from 'react-i18next';

import { Switch } from '../../components/Switch';
import type { ContractMonths, Household } from './api';
import { HOUSEHOLDS } from './constants';
import { usePreferenceLabels } from './OwnerPreferences';
import { RoomFields } from './RoomFields';
import type { FieldError, FieldErrors, FieldName, ListingForm } from './validate';

const label = 'text-sm font-bold';
const input =
  'min-h-[48px] w-full rounded-xl border-[1.5px] border-border-strong bg-surface px-3 text-start text-base font-semibold text-ink focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-soft aria-[invalid=true]:border-danger';
const fieldError = 'text-sm font-semibold text-danger';
const card = 'flex flex-col divide-y divide-border rounded-2xl border border-border bg-surface';
// ChoiceGroup's segmented button, for a checkbox.
const segment =
  'flex min-h-[44px] flex-1 cursor-pointer items-center justify-center rounded-xl border-[1.5px] border-border-strong bg-surface px-3 text-center text-[15px] font-semibold peer-checked:border-accent peer-checked:bg-accent-soft peer-checked:font-bold peer-checked:text-accent-strong peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent group-aria-[invalid=true]:border-danger';

const CONTRACT_OPTIONS: readonly ContractMonths[] = [6, 12, 24, 36];

type Props = {
  form: ListingForm;
  onChange: (patch: Partial<ListingForm>) => void;
  errors: FieldErrors;
  /** Element id of a field's input; the wizard focuses the first invalid one by id. */
  fieldId: (name: FieldName) => string;
};

/** Step 3: who the listing suits (CreateListing.dc.html's "העדפות"); for a room also the room block
 * (0007e). */
export function PreferencesStep({ form, onChange, errors, fieldId }: Props) {
  const { t } = useTranslation();
  const labels = usePreferenceLabels();

  const errorId = (name: FieldName) => `${fieldId(name)}-error`;
  const a11y = (name: FieldName) => ({
    id: fieldId(name),
    'aria-invalid': errors[name] !== undefined,
    'aria-describedby': errors[name] ? errorId(name) : undefined,
  });
  function message(error: FieldError): string {
    const { key, ...params } = error;
    return t(key, params);
  }
  const errorText = (name: FieldName) => {
    const error = errors[name];
    if (error === undefined) return null;
    return (
      <p id={errorId(name)} role="alert" className={fieldError}>
        {message(error)}
      </p>
    );
  };

  function toggle(household: Household, checked: boolean) {
    const others = form.accepted_households.filter((h) => h !== household);
    onChange({ accepted_households: checked ? [...others, household] : others });
  }

  const householdsInvalid = errors.accepted_households !== undefined;
  const room = form.listing_type === 'room';

  return (
    <div className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-1">
        <h2 className="text-start text-xl font-extrabold">
          {room ? t('listings.prefs.titleRoom') : t('listings.prefs.title')}
        </h2>
        <p className="text-sm text-ink-muted">{t('listings.prefs.hint')}</p>
      </div>

      <fieldset
        aria-invalid={householdsInvalid}
        aria-describedby={householdsInvalid ? errorId('accepted_households') : undefined}
        className="group flex flex-col"
      >
        <legend className="mb-2 text-sm font-bold">{t('listings.prefs.households')}</legend>
        <div className="grid grid-cols-2 gap-2">
          {HOUSEHOLDS.map((household, i) => {
            const id = `${fieldId('accepted_households')}${i === 0 ? '' : `-${household}`}`;
            return (
              <div key={household} className="flex">
                <input
                  id={id}
                  type="checkbox"
                  checked={form.accepted_households.includes(household)}
                  onChange={(e) => toggle(household, e.target.checked)}
                  className="peer sr-only"
                />
                <label htmlFor={id} className={segment}>
                  {labels.households[household]}
                </label>
              </div>
            );
          })}
        </div>
        {householdsInvalid && <div className="mt-[6px]">{errorText('accepted_households')}</div>}
      </fieldset>

      <div className={card}>
        <Switch
          label={t('listings.prefs.noSmokers')}
          checked={!form.smoking_allowed}
          onChange={(noSmokers) => onChange({ smoking_allowed: !noSmokers })}
        />
      </div>

      <div className="flex flex-col gap-[6px]">
        <label htmlFor={fieldId('min_contract_months')} className={label}>
          {t('listings.prefs.minContract')}
        </label>
        <select
          {...a11y('min_contract_months')}
          value={String(form.min_contract_months ?? '')}
          onChange={(e) =>
            onChange({
              min_contract_months:
                CONTRACT_OPTIONS.find((months) => String(months) === e.target.value) ?? null,
            })
          }
          className={input}
        >
          <option value="">{t('listings.prefs.contract.none')}</option>
          {CONTRACT_OPTIONS.map((months) => (
            <option key={months} value={String(months)}>
              {labels.contract[months]}
            </option>
          ))}
        </select>
        {errorText('min_contract_months')}
      </div>

      {room && <RoomFields form={form} onChange={onChange} errors={errors} fieldId={fieldId} />}
    </div>
  );
}
