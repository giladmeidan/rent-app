import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { AreaOut } from '../../api/client';
import { ChoiceGroup, type ChoiceOption } from '../../components/ChoiceGroup';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { Switch } from '../../components/Switch';
import { hasStatus } from '../applications/api';
import { fetchAreas } from '../areas/api';
import { safeNext } from '../auth/next';
import { LifestyleFields } from '../lifestyle/LifestyleFields';
import { ApiError } from '../listings/api';
import { addDays, todayInIsrael } from '../listings/format';
import type {
  ContractMonths,
  FlatmateGender,
  Gender,
  Household,
  SeekerProfileIn,
  SeekerProfileOut,
} from './api';
import { useProfile } from './useProfile';
import { useSaveProfile } from './useSaveProfile';
import {
  BUDGET,
  emptyProfileForm,
  firstInvalid,
  formFromProfile,
  MOVE_IN_MAX_DAYS,
  serverFieldErrors,
  toProfileIn,
  validate,
  type FieldError,
  type FieldErrors,
  type FieldName,
  type ProfileForm,
} from './validate';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const label = 'text-sm font-bold';
const box =
  'flex min-h-[48px] items-center gap-[6px] rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-3 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-tint has-[[aria-invalid=true]]:border-[#B91C1C]';
const bare =
  'min-w-0 flex-1 border-0 bg-transparent text-start text-base font-semibold text-ink outline-none';
const input =
  'min-h-[48px] w-full rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-3 text-start text-base font-semibold text-ink focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-tint aria-[invalid=true]:border-[#B91C1C]';
const suffix = 'shrink-0 text-sm text-muted';
const fieldError = 'text-sm font-semibold text-[#B91C1C]';
const card = 'flex flex-col divide-y divide-[#F0EEEB] rounded-2xl border border-line bg-white';
// ChoiceGroup's label classes, for the area checkboxes.
const chip =
  'flex min-h-[44px] flex-1 cursor-pointer items-center justify-center rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-3 text-center text-[15px] font-semibold peer-checked:border-accent peer-checked:bg-accent-tint peer-checked:font-bold peer-checked:text-accent-text peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-aria-[invalid=true]:border-[#B91C1C]';
const primary = `inline-flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-accent px-5 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;

type FormProps = {
  initial: SeekerProfileOut | null;
  /** `GET /areas` as last loaded; a failed background refetch keeps the previous list. */
  areas: AreaOut[];
  refetchAreas: () => void;
};

/** The form itself. It keeps its own state after the first render: no refetch overwrites it. */
function ProfileFormView({ initial, areas, refetchAreas }: FormProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const save = useSaveProfile();
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const roomHeading = useRef<HTMLHeadingElement>(null);
  // `?section=room` (0007f's apply gate, `roomSectionHref`) opens the room section and lands on it.
  const roomEntry = params.get('section') === 'room';

  const [form, setForm] = useState<ProfileForm>(() => {
    const start = initial === null ? emptyProfileForm : formFromProfile(initial);
    return roomEntry ? { ...start, room: true } : start;
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  // Same-tick guard: a double click sends one request.
  const inFlight = useRef(false);
  const lastBody = useRef<SeekerProfileIn | null>(null);

  useEffect(() => {
    // Focusing the heading also scrolls it into view.
    if (roomEntry) roomHeading.current?.focus();
  }, [roomEntry]);

  const today = todayInIsrael();
  const fieldId = (name: FieldName) => `${id}-${name}`;
  const errorId = (name: FieldName) => `${fieldId(name)}-error`;

  /** Focuses a field's (first) input: by `name`, so a radio group or the areas work too. */
  function focus(name: FieldName) {
    formRef.current?.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.focus();
  }

  function change(patch: Partial<ProfileForm>, field?: FieldName) {
    setForm((f) => ({ ...f, ...patch }));
    if (field !== undefined && errors[field] !== undefined) {
      setErrors((shown) => ({ ...shown, [field]: undefined }));
    }
    // Retry re-sends the last body, so it is offered only while the form is unchanged.
    setFailed(false);
    setSaved(false);
  }

  function send(body: SeekerProfileIn) {
    if (inFlight.current) return;
    inFlight.current = true;
    lastBody.current = body;
    setFailed(false);
    setSaved(false);
    save.mutate(body, {
      onSettled: () => {
        inFlight.current = false;
      },
      onSuccess: () => {
        setSaved(true);
        const next = safeNext(params.get('next'));
        if (next !== '/') void navigate(next, { replace: true });
      },
      onError: (error) => {
        // 401: the hook forgets the session and RequireSeeker leaves the page.
        if (hasStatus(error, 401)) return;
        if (error instanceof ApiError && error.status === 422) {
          if (error.detail === 'unknown_area') {
            refetchAreas();
            setErrors({ area_ids: { key: 'profile.errors.areaInactive' } });
            focus('area_ids');
            return;
          }
          const found = serverFieldErrors(error.detail);
          const first = firstInvalid(found);
          if (first !== undefined) {
            setErrors(found);
            focus(first);
            return;
          }
        }
        setFailed(true);
      },
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const found = validate(form, areas, today);
    setErrors(found);
    const first = firstInvalid(found);
    if (first !== undefined) {
      setSaved(false);
      focus(first);
      return;
    }
    send(toProfileIn(form, areas));
  }

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
  const a11y = (name: FieldName) => ({
    id: fieldId(name),
    name,
    'aria-invalid': errors[name] !== undefined,
    'aria-describedby': errors[name] !== undefined ? errorId(name) : undefined,
  });
  const groupError = (name: FieldName) => {
    const error = errors[name];
    return error === undefined ? undefined : message(error);
  };

  const household: ChoiceOption<Household>[] = [
    { value: 'single', label: t('profile.household.single') },
    { value: 'couple', label: t('profile.household.couple') },
    { value: 'family', label: t('profile.household.family') },
    { value: 'roommates', label: t('profile.household.roommates') },
  ];
  const contract: ChoiceOption<ContractMonths>[] = [
    { value: 6, label: t('profile.contract.6') },
    { value: 12, label: t('profile.contract.12') },
    { value: 24, label: t('profile.contract.24') },
    { value: 36, label: t('profile.contract.36') },
  ];
  const genders: ChoiceOption<Gender>[] = [
    { value: 'woman', label: t('profile.room.gender.woman') },
    { value: 'man', label: t('profile.room.gender.man') },
    { value: 'other', label: t('profile.room.gender.other') },
  ];
  const flatmates: ChoiceOption<FlatmateGender>[] = [
    { value: 'women', label: t('rooms.genderPreference.women') },
    { value: 'men', label: t('rooms.genderPreference.men') },
    { value: 'any', label: t('rooms.genderPreference.any') },
  ];
  const parking: ChoiceOption<number>[] = [
    { value: 0, label: t('profile.parking.0') },
    { value: 1, label: t('profile.parking.1') },
    { value: 2, label: t('profile.parking.2') },
  ];

  const areaError = errors.area_ids;
  const areasControl =
    areas.length === 0 ? (
      <EmptyState message={t('areas.empty')} />
    ) : (
      <fieldset className="flex flex-col">
        <legend className="mb-2 text-sm font-bold">{t('profile.fields.areas')}</legend>
        <div className="flex flex-wrap gap-2">
          {areas.map((area) => {
            const checkboxId = `${fieldId('area_ids')}-${area.id}`;
            return (
              <div key={area.id} className="flex">
                <input
                  id={checkboxId}
                  type="checkbox"
                  name="area_ids"
                  value={area.id}
                  checked={form.area_ids.has(area.id)}
                  onChange={(e) => {
                    const next = new Set(form.area_ids);
                    if (e.target.checked) next.add(area.id);
                    else next.delete(area.id);
                    change({ area_ids: next }, 'area_ids');
                  }}
                  aria-invalid={areaError !== undefined ? true : undefined}
                  aria-describedby={areaError !== undefined ? errorId('area_ids') : undefined}
                  className="peer sr-only"
                />
                <label htmlFor={checkboxId} className={chip}>
                  {area.name_he}
                </label>
              </div>
            );
          })}
        </div>
        {areaError !== undefined && <div className="mt-[6px]">{errorText('area_ids')}</div>}
      </fieldset>
    );

  return (
    <form ref={formRef} noValidate onSubmit={onSubmit} className="flex flex-col gap-[22px]">
      <div className="flex flex-col gap-[6px]">
        <label htmlFor={fieldId('budget_max_ils')} className={label}>
          {t('profile.fields.budget')}
        </label>
        <div className={`${box} min-h-[52px]`}>
          <input
            {...a11y('budget_max_ils')}
            type="number"
            inputMode="numeric"
            min={BUDGET.min}
            max={BUDGET.max}
            value={form.budget_max_ils}
            onChange={(e) => change({ budget_max_ils: e.target.value }, 'budget_max_ils')}
            className={bare}
          />
          <span className={suffix}>{t('listings.units.ils')}</span>
        </div>
        {errorText('budget_max_ils')}
      </div>

      <div className="flex flex-col gap-[6px]">
        <label htmlFor={fieldId('move_in_date')} className={label}>
          {t('profile.fields.moveIn')}
        </label>
        <input
          {...a11y('move_in_date')}
          type="date"
          min={today}
          max={addDays(today, MOVE_IN_MAX_DAYS)}
          value={form.move_in_date}
          onChange={(e) => change({ move_in_date: e.target.value }, 'move_in_date')}
          className={input}
        />
        {errorText('move_in_date')}
        <div className={card}>
          <Switch
            label={t('profile.fields.flexible')}
            checked={form.move_in_flexible}
            onChange={(move_in_flexible) => change({ move_in_flexible })}
          />
        </div>
      </div>

      {areasControl}

      <ChoiceGroup
        legend={t('profile.fields.household')}
        name="household"
        options={household}
        value={form.household}
        onChange={(value) => change({ household: value }, 'household')}
        error={groupError('household')}
      />

      <div className={card}>
        <Switch
          label={t('profile.fields.pets')}
          checked={form.has_pets}
          onChange={(has_pets) => change({ has_pets })}
        />
        <Switch
          label={t('profile.fields.smoker')}
          checked={form.smoker}
          onChange={(smoker) => change({ smoker })}
        />
      </div>

      <ChoiceGroup
        legend={t('profile.fields.contract')}
        name="contract_months"
        options={contract}
        value={form.contract_months}
        onChange={(value) => change({ contract_months: value }, 'contract_months')}
        error={groupError('contract_months')}
      />

      <ChoiceGroup
        legend={t('profile.fields.parking')}
        name="parking_needed"
        options={parking}
        value={form.parking_needed}
        onChange={(value) => change({ parking_needed: value }, 'parking_needed')}
        error={groupError('parking_needed')}
      />

      <section aria-labelledby={`${id}-room`} className="flex flex-col gap-[22px]">
        <div className="flex flex-col gap-1">
          <h2
            ref={roomHeading}
            id={`${id}-room`}
            tabIndex={-1}
            className="text-start text-xl font-extrabold focus:outline-none"
          >
            {t('profile.room.title')}
          </h2>
          <p className="text-start text-sm text-muted">{t('profile.room.hint')}</p>
        </div>
        <div className={card}>
          <Switch
            label={t('profile.room.switch')}
            checked={form.room}
            onChange={(room) => {
              change({ room });
              // Errors are only for a section that is on: none comes back stale on switching on.
              setErrors((shown) => ({ ...shown, gender: undefined, birth_year: undefined }));
            }}
          />
        </div>
        {form.room && (
          <div className="flex flex-col gap-[22px]">
            <p className="text-start text-sm text-muted">{t('profile.room.privacy')}</p>

            <div className="flex flex-col gap-[6px]">
              <ChoiceGroup
                legend={t('profile.room.fields.gender')}
                name="gender"
                options={genders}
                value={form.gender}
                onChange={(value) => change({ gender: value }, 'gender')}
                error={groupError('gender')}
              />
              <p className="text-start text-sm text-muted">{t('profile.room.genderNote')}</p>
            </div>

            <div className="flex flex-col gap-[6px]">
              <label htmlFor={fieldId('birth_year')} className={label}>
                {t('profile.room.fields.birthYear')}
              </label>
              <div className={box}>
                <input
                  {...a11y('birth_year')}
                  aria-describedby={
                    errors.birth_year !== undefined
                      ? `${fieldId('birth_year')}-hint ${errorId('birth_year')}`
                      : `${fieldId('birth_year')}-hint`
                  }
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={form.birth_year}
                  onChange={(e) => change({ birth_year: e.target.value }, 'birth_year')}
                  className={bare}
                />
              </div>
              <p id={`${fieldId('birth_year')}-hint`} className="text-start text-sm text-muted">
                {t('profile.room.birthYearHint')}
              </p>
              {errorText('birth_year')}
            </div>

            <ChoiceGroup
              legend={t('profile.room.fields.flatmates')}
              name="flatmate_gender"
              options={flatmates}
              value={form.flatmate_gender}
              onChange={(value) => change({ flatmate_gender: value })}
            />

            <LifestyleFields
              perspective="seeker"
              value={form.lifestyle}
              onChange={(lifestyle) => change({ lifestyle })}
            />
          </div>
        )}
      </section>

      {areas.length > 0 && (
        <div className="flex flex-col gap-3 pt-2">
          {failed && (
            <ErrorState
              onRetry={() => {
                if (lastBody.current !== null) send(lastBody.current);
              }}
            />
          )}
          <button
            type="submit"
            disabled={save.isPending}
            aria-busy={save.isPending}
            className={primary}
          >
            {t('profile.save')}
          </button>
          {saved && (
            <p role="status" className="text-start text-[15px] font-bold text-accent-text">
              {t('profile.saved')}
            </p>
          )}
        </div>
      )}
    </form>
  );
}

/**
 * `/me/profile`, seekers only (`RequireSeeker`): the housing profile, empty or prefilled, and the
 * optional room section. Saved with a safe `?next=` it returns there (the listing page's gate);
 * otherwise it stays. `?section=room` opens the room section and focuses its heading.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  const profile = useProfile();
  // The key `AreasList` and `ListingWizard` use.
  const areas = useQuery({ queryKey: ['areas'], queryFn: fetchAreas });

  const profileFailed = profile.isError && profile.data === undefined;
  const areasFailed = areas.isError && areas.data === undefined;

  let body;
  if (profileFailed || areasFailed) {
    // Only when nothing is cached: a failed background refetch keeps the form and what was typed.
    body = (
      <ErrorState
        onRetry={() => {
          if (profileFailed) void profile.refetch();
          if (areasFailed) void areas.refetch();
        }}
      />
    );
  } else if (profile.data === undefined || areas.data === undefined) {
    body = (
      <div aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton />
      </div>
    );
  } else {
    body = (
      <ProfileFormView
        initial={profile.data}
        areas={areas.data}
        refetchAreas={() => void areas.refetch()}
      />
    );
  }

  return (
    <section className="mx-auto flex w-full max-w-[480px] flex-col gap-4">
      <h1 className="text-start text-2xl font-extrabold">{t('profile.title')}</h1>
      <p className="text-start text-[15px]">{t('profile.intro')}</p>
      <p className="text-start text-sm text-muted">{t('profile.privacy')}</p>
      {body}
    </section>
  );
}
