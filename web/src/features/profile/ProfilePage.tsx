import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import type { AreaOut } from '../../api/client';
import { usePageTitle } from '../../app/usePageTitle';
import { Button } from '../../components/Button';
import { retryAfterText } from '../../components/retryAfter';
import { Card } from '../../components/Card';
import { ChoiceGroup, type ChoiceOption } from '../../components/ChoiceGroup';
import { cx } from '../../components/cx';
import { DateReadback, withReadback } from '../../components/DateReadback';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Field } from '../../components/Field';
import { focusRing } from '../../components/focusRing';
import { Loading } from '../../components/Loading';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { Skeleton } from '../../components/Skeleton';
import { Tag } from '../../components/Tag';
import { Switch } from '../../components/Switch';
import { TextInput } from '../../components/TextInput';
import { Textarea } from '../../components/Textarea';
import { hasStatus } from '../applications/api';
import { areasQuery } from '../areas/api';
import { areaLabel } from '../areas/areaLabel';
import { AreaSearch } from '../areas/AreaSearch';
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
  ShelterNeeded,
} from './api';
import { DeleteAccountSection } from './DeleteAccountSection';
import { PasswordSection } from './PasswordSection';
import { PersonPhoto } from './PersonPhoto';
import { useProfile } from './useProfile';
import { useSaveProfile } from './useSaveProfile';
import {
  ABOUT_ME_MAX,
  AREAS_MAX,
  BUDGET,
  emptyProfileForm,
  firstInvalid,
  formFromProfile,
  MOVE_IN_MAX_DAYS,
  serverFieldErrors,
  toProfileIn,
  validate,
  visibleAreaIds,
  type FieldError,
  type FieldErrors,
  type FieldName,
  type ProfileForm,
} from './validate';

const sectionHeading = 'font-display text-h2';
const mutedNote = 'text-body-sm text-ink-muted';
// Preferred areas are cities and neighbourhoods (spec 0021b).
const PREFERRED_KINDS = ['settlement', 'neighbourhood'] as const;
const REMOVE = (
  <svg
    aria-hidden="true"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const switchCard = 'flex flex-col divide-y divide-border';
const navLink = cx(
  'flex min-h-11 items-center rounded-md px-3 text-body font-medium text-ink-muted hover:bg-surface-subtle hover:text-ink',
  focusRing,
);

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
  const aboutHeading = useRef<HTMLHeadingElement>(null);
  const lookingHeading = useRef<HTMLHeadingElement>(null);
  // `?section=about` / `?section=looking` (repeatable; `profileHref`, the apply and like gates)
  // switch those parts on and land on the first one listed (0010c).
  const sections = params.getAll('section');
  const openAbout = sections.includes('about');
  const openLooking = sections.includes('looking');
  const landOn = sections.find((s) => s === 'about' || s === 'looking');

  const [form, setForm] = useState<ProfileForm>(() => {
    const start = initial === null ? emptyProfileForm : formFromProfile(initial);
    return {
      ...start,
      personal: start.personal || openAbout,
      looking: start.looking || openLooking,
    };
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failed, setFailed] = useState(false);
  // A 429 on save: its `Retry-After` in seconds (null: none sent); undefined: not rate limited.
  const [rateLimit, setRateLimit] = useState<number | null | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  // Same-tick guard: a double click sends one request.
  const inFlight = useRef(false);
  const lastBody = useRef<SeekerProfileIn | null>(null);

  useEffect(() => {
    // Focusing the heading also scrolls it into view.
    if (landOn === 'about') aboutHeading.current?.focus();
    else if (landOn === 'looking') lookingHeading.current?.focus();
  }, [landOn]);

  // An in-page save (no `next` navigation follows): the "saved" line takes focus, which also
  // scrolls it into view (spec 0009t). It is mounted with its text, so focus is its announcement.
  const savedRef = useRef<HTMLParagraphElement>(null);
  const stays = safeNext(params.get('next')) === '/';
  useEffect(() => {
    if (saved && stays) savedRef.current?.focus();
  }, [saved, stays]);

  const today = todayInIsrael();
  const fieldId = (name: FieldName) => `${id}-${name}`;

  /** Focuses a field's (first) input: by `name`, so a radio group or the areas work too. */
  function focus(name: FieldName) {
    formRef.current?.querySelector<HTMLElement>(`[name="${name}"]`)?.focus();
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
    setRateLimit(undefined);
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
        // 401: the hook forgets the session and RequireUser leaves the page.
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
        if (error instanceof ApiError && error.status === 429) {
          setRateLimit(error.retryAfter);
          return;
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
  const shelters: ChoiceOption<ShelterNeeded>[] = [
    { value: 'any', label: t('profile.shelter.any') },
    { value: 'protected', label: t('profile.shelter.protected') },
    { value: 'mamad', label: t('profile.shelter.mamad') },
  ];

  const areasById = new Map(areas.map((area) => [area.id, area]));
  const chosenAreas = visibleAreaIds(form, areas).flatMap((areaId) => areasById.get(areaId) ?? []);
  const setAreas = (ids: string[]) => change({ area_ids: new Set(ids) }, 'area_ids');
  const removeArea = (areaId: string) =>
    setAreas([...form.area_ids].filter((other) => other !== areaId));
  const areasControl =
    areas.length === 0 ? (
      <EmptyState message={t('areas.empty')} />
    ) : (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-label text-ink">{t('profile.fields.areas')}</legend>
        {chosenAreas.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {chosenAreas.map((area) => {
              const name = areaLabel(t, area, areasById);
              return (
                <Tag key={area.id} as="li" tone="accent">
                  {name}
                  <button
                    type="button"
                    aria-label={t('profile.areas.remove', { name })}
                    onClick={() => removeArea(area.id)}
                    className={cx(
                      'inline-flex size-6 shrink-0 items-center justify-center rounded-full',
                      focusRing,
                    )}
                  >
                    {REMOVE}
                  </button>
                </Tag>
              );
            })}
          </ul>
        )}
        <AreaSearch
          label={t('profile.fields.areasSearch')}
          kinds={PREFERRED_KINDS}
          name="area_ids"
          error={groupError('area_ids')}
          onPick={(area) => {
            if (area === null || form.area_ids.has(area.id)) return;
            if (chosenAreas.length >= AREAS_MAX) {
              setErrors((shown) => ({ ...shown, area_ids: { key: 'profile.errors.areasMax' } }));
              return;
            }
            setAreas([...form.area_ids, area.id]);
          }}
          onBackspace={() => {
            const last = chosenAreas.at(-1);
            if (last !== undefined) removeArea(last.id);
          }}
        />
      </fieldset>
    );

  const aboutId = `${id}-about`;
  const lookingId = `${id}-looking`;
  const householdHeading = `${id}-household`;
  const peopleHeading = `${id}-people`;
  const both = form.looking && form.personal;

  /** A part's switch: errors are only for a part that is on, so none comes back stale on switching
   * it on; the "fill one part" alert goes with any change of a switch. */
  function switchPart(patch: Pick<ProfileForm, 'personal'> | Pick<ProfileForm, 'looking'>) {
    change(patch);
    const cleared: FieldName[] =
      'personal' in patch
        ? ['gender', 'birth_year', 'about_me', 'form']
        : ['budget_max_ils', 'move_in_date', 'area_ids', 'household', 'contract_months', 'form'];
    setErrors((shown) => {
      const next = { ...shown };
      for (const name of cleared) next[name] = undefined;
      return next;
    });
  }

  return (
    <>
      <nav
        aria-label={t('profile.nav.label')}
        className="hidden lg:sticky lg:top-6 lg:col-start-1 lg:row-start-2 lg:block lg:self-start lg:rounded-lg lg:border lg:border-border lg:bg-surface lg:p-6"
      >
        <ul className="flex flex-col gap-1">
          <li>
            <a href="#profile-about" className={navLink}>
              {t('profile.about.title')}
            </a>
          </li>
          {form.personal && (
            <li>
              <a href="#profile-lifestyle" className={cx(navLink, 'ps-6')}>
                {t('lifestyle.title.seeker')}
              </a>
            </li>
          )}
          <li>
            <a href="#profile-looking" className={navLink}>
              {t('profile.sections.search')}
            </a>
          </li>
          <li>
            <a href="#profile-people" className={navLink}>
              {t('profile.people.title')}
            </a>
          </li>
        </ul>
      </nav>

      <form
        ref={formRef}
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-8 lg:col-start-2 lg:row-start-2"
      >
        <section
          id="profile-about"
          aria-labelledby={aboutId}
          className="flex scroll-mt-6 flex-col gap-6"
        >
          <div className="flex flex-col gap-1">
            <h2
              ref={aboutHeading}
              id={aboutId}
              tabIndex={-1}
              className={cx(sectionHeading, 'focus:outline-none')}
            >
              {t('profile.about.title')}
            </h2>
            <p className={mutedNote}>{t('profile.about.hint')}</p>
          </div>
          {/* Saved on its own (not with the form), so it shows with the switch off too. */}
          <PersonPhoto />
          <Card padding="none" className={switchCard}>
            <Switch
              label={t('profile.about.switch')}
              checked={form.personal}
              onChange={(personal) => switchPart({ personal })}
            />
          </Card>
          {form.personal && (
            <>
              <div className="flex flex-col gap-1.5">
                <ChoiceGroup
                  legend={t('profile.room.fields.gender')}
                  name="gender"
                  options={genders}
                  value={form.gender}
                  onChange={(value) => change({ gender: value }, 'gender')}
                  error={groupError('gender')}
                />
                <p className={mutedNote}>{t('profile.room.genderNote')}</p>
              </div>

              <Field
                id={fieldId('birth_year')}
                label={t('profile.room.fields.birthYear')}
                hint={t('profile.room.birthYearHint')}
                error={groupError('birth_year')}
              >
                <TextInput
                  name="birth_year"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  className="sm:max-w-xs"
                  value={form.birth_year}
                  onChange={(e) => change({ birth_year: e.target.value }, 'birth_year')}
                />
              </Field>

              <Field
                id={fieldId('about_me')}
                label={t('profile.room.aboutMe')}
                hint={t('listings.fields.charsLeft', {
                  count: ABOUT_ME_MAX - form.about_me.length,
                })}
                error={groupError('about_me')}
              >
                <Textarea
                  name="about_me"
                  rows={4}
                  maxLength={ABOUT_ME_MAX}
                  dir="auto"
                  value={form.about_me}
                  onChange={(e) => change({ about_me: e.target.value }, 'about_me')}
                />
              </Field>

              <div id="profile-lifestyle" className="scroll-mt-6 border-t border-border pt-6">
                <LifestyleFields
                  perspective="seeker"
                  value={form.lifestyle}
                  onChange={(lifestyle) => change({ lifestyle })}
                />
              </div>

              <p className={mutedNote}>{t('profile.about.privacy')}</p>
            </>
          )}
        </section>

        <section
          id="profile-looking"
          aria-labelledby={lookingId}
          className="flex scroll-mt-6 flex-col gap-6 border-t border-border pt-8"
        >
          <div className="flex flex-col gap-1">
            <h2
              ref={lookingHeading}
              id={lookingId}
              tabIndex={-1}
              className={cx(sectionHeading, 'focus:outline-none')}
            >
              {t('profile.sections.search')}
            </h2>
          </div>
          <div className="flex flex-col gap-1.5">
            <Card padding="none" className={switchCard}>
              <Switch
                label={t('profile.looking.switch')}
                checked={form.looking}
                onChange={(looking) => switchPart({ looking })}
                describedBy={`${lookingId}-hint`}
              />
            </Card>
            <p id={`${lookingId}-hint`} className={mutedNote}>
              {t('profile.looking.hint')}
            </p>
          </div>
          {form.looking && (
            <>
              <div id="profile-search" className="flex scroll-mt-6 flex-col gap-6">
                <div className="flex flex-col gap-6 md:grid md:grid-cols-2 md:items-start md:gap-4">
                  <Field
                    id={fieldId('budget_max_ils')}
                    label={t('profile.fields.budget')}
                    error={groupError('budget_max_ils')}
                  >
                    <TextInput
                      name="budget_max_ils"
                      size="lg"
                      end={t('listings.units.ils')}
                      type="number"
                      inputMode="numeric"
                      min={BUDGET.min}
                      max={BUDGET.max}
                      value={form.budget_max_ils}
                      onChange={(e) => change({ budget_max_ils: e.target.value }, 'budget_max_ils')}
                    />
                  </Field>

                  <div className="flex flex-col gap-1.5">
                    <Field
                      id={fieldId('move_in_date')}
                      label={t('profile.fields.moveIn')}
                      error={groupError('move_in_date')}
                    >
                      <TextInput
                        name="move_in_date"
                        aria-describedby={withReadback(
                          undefined,
                          `${fieldId('move_in_date')}-chosen`,
                          form.move_in_date,
                        )}
                        type="date"
                        min={today}
                        max={addDays(today, MOVE_IN_MAX_DAYS)}
                        value={form.move_in_date}
                        onChange={(e) => change({ move_in_date: e.target.value }, 'move_in_date')}
                      />
                    </Field>
                    <DateReadback
                      id={`${fieldId('move_in_date')}-chosen`}
                      value={form.move_in_date}
                    />
                    <Card padding="none" className={switchCard}>
                      <Switch
                        label={t('profile.fields.flexible')}
                        checked={form.move_in_flexible}
                        onChange={(move_in_flexible) => change({ move_in_flexible })}
                      />
                    </Card>
                  </div>
                </div>

                {areasControl}
              </div>

              <section
                id="profile-household"
                aria-labelledby={householdHeading}
                className="flex scroll-mt-6 flex-col gap-6 border-t border-border pt-6"
              >
                <h3 id={householdHeading} className="text-h3">
                  {t('profile.sections.household')}
                </h3>

                <ChoiceGroup
                  legend={t('profile.fields.household')}
                  name="household"
                  options={household}
                  value={form.household}
                  onChange={(value) => change({ household: value }, 'household')}
                  error={groupError('household')}
                />

                <Card padding="none" className={switchCard}>
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
                </Card>

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

                <ChoiceGroup
                  legend={t('profile.fields.shelter')}
                  name="shelter_needed"
                  stacked
                  options={shelters}
                  value={form.shelter_needed}
                  onChange={(value) => change({ shelter_needed: value })}
                />

                {form.personal ? (
                  <ChoiceGroup
                    legend={t('profile.room.fields.flatmates')}
                    name="flatmate_gender"
                    options={flatmates}
                    value={form.flatmate_gender}
                    onChange={(value) => change({ flatmate_gender: value })}
                  />
                ) : (
                  <p className={mutedNote}>{t('profile.looking.flatmatesNeedsAbout')}</p>
                )}
              </section>
            </>
          )}
        </section>

        <section
          id="profile-people"
          aria-labelledby={peopleHeading}
          className="flex scroll-mt-6 flex-col gap-6 border-t border-border pt-8"
        >
          <h2 id={peopleHeading} className={sectionHeading}>
            {t('profile.people.title')}
          </h2>
          {both ? (
            <div className="flex flex-col gap-1.5">
              <Card padding="none" className={switchCard}>
                <Switch
                  label={t('profile.people.visible')}
                  checked={form.people_visible}
                  onChange={(people_visible) => change({ people_visible })}
                  describedBy={`${peopleHeading}-hint`}
                />
              </Card>
              <p id={`${peopleHeading}-hint`} className={mutedNote}>
                {t('profile.people.visibleHint')}
              </p>
            </div>
          ) : (
            <p className={mutedNote}>{t('profile.people.needsBoth')}</p>
          )}
        </section>

        {areas.length > 0 && (
          <div
            data-sticky-footer
            className="sticky z-10 -mx-4 flex flex-col gap-2 border-t border-border bg-surface px-4 py-3 max-lg:bottom-[calc(var(--bottom-nav-h,0px)+env(safe-area-inset-bottom,0px))] sm:mx-0 sm:rounded-lg sm:border lg:bottom-0"
          >
            {errors.form !== undefined && (
              <p role="alert" className="text-body-sm text-danger">
                {message(errors.form)}
              </p>
            )}
            {rateLimit !== undefined && (
              <p role="alert" className="text-body-sm text-danger">
                {rateLimit !== null
                  ? t('profile.errors.rateLimitedIn', { when: retryAfterText(t, rateLimit) })
                  : t('profile.errors.rateLimited')}
              </p>
            )}
            {failed && (
              <ErrorState
                onRetry={() => {
                  if (lastBody.current !== null) send(lastBody.current);
                }}
              />
            )}
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              {saved && (
                <p
                  ref={savedRef}
                  tabIndex={-1}
                  role="status"
                  className="text-body font-medium text-success empty:hidden focus:outline-none"
                >
                  {t('profile.saved')}
                </p>
              )}
              <Button
                variant="primary"
                size="lg"
                fullWidth
                type="submit"
                disabled={save.isPending}
                aria-busy={save.isPending}
                className="lg:ms-auto lg:w-auto lg:min-w-48"
              >
                {t('profile.save')}
              </Button>
            </div>
          </div>
        )}
      </form>
    </>
  );
}

/**
 * `/me/profile`, any account (`RequireUser`, spec 0010b): the profile in two parts (0010c), "עליי"
 * (the personal part) and "מה מחפשים" (the looking part), either alone or both, and the people
 * switch that needs both. Saved with a safe `?next=` it returns there (the listing page's gates);
 * otherwise it stays. `?section=about` / `?section=looking` switch those parts on and focus the first.
 */
export function ProfilePage() {
  const { t } = useTranslation();
  usePageTitle(t('profile.title'));
  const profile = useProfile();
  const areas = useQuery(areasQuery);

  const profileFailed = profile.isError && profile.data === undefined;
  const areasFailed = areas.isError && areas.data === undefined;

  let body;
  if (profileFailed || areasFailed) {
    // Only when nothing is cached: a failed background refetch keeps the form and what was typed.
    body = (
      <div className="lg:col-start-2">
        <ErrorState
          onRetry={() =>
            Promise.all([profileFailed && profile.refetch(), areasFailed && areas.refetch()])
          }
        />
      </div>
    );
  } else if (profile.data === undefined || areas.data === undefined) {
    body = (
      <div className="lg:col-start-2">
        <Loading>
          <Skeleton />
        </Loading>
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
    <PageContainer as="section" width="wide">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 lg:grid lg:max-w-none lg:grid-cols-[18rem_minmax(0,42rem)] lg:justify-center lg:gap-x-8 lg:gap-y-6">
        <div className="flex flex-col gap-1 lg:col-span-2">
          <PageHeader title={t('profile.title')} subtitle={t('profile.intro')} />
          <p className={mutedNote}>{t('profile.privacy')}</p>
        </div>
        {body}
        <PasswordSection className="lg:col-start-2" />
        <DeleteAccountSection className="lg:col-start-2" />
      </div>
    </PageContainer>
  );
}
