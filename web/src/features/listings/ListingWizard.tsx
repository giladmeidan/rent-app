import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';

import type { UserOut } from '../../api/client';
import { Button } from '../../components/Button';
import { useConfirm } from '../../components/Dialog';
import { PageHeader } from '../../components/PageHeader';
import { fetchAreas } from '../areas/api';
import { ME_KEY } from '../auth/useMe';
import { ApiError, type ListingOut, type ListingType, type MyListingOut } from './api';
import { DetailsStep } from './DetailsStep';
import { todayInIsrael } from './format';
import { PreferencesStep } from './PreferencesStep';
import { PreviewStep, type PublishError } from './PreviewStep';
import { TypeStep } from './TypeStep';
import { useCreateListing } from './useCreateListing';
import { MY_LISTINGS_KEY } from './useMyListings';
import { usePatchListing } from './usePatchListing';
import {
  changedFields,
  emptyForm,
  firstInvalid,
  FIELD_ORDER,
  formFromListing,
  toListingIn,
  validate,
  validatePreferences,
  type FieldErrors,
  type FieldName,
  type ListingForm,
} from './validate';

type Step = 1 | 2 | 3 | 4;
type Outcome = PublishError | 'unauthenticated' | 'forbidden' | 'notFound';

function outcome(error: Error): Outcome {
  if (!(error instanceof ApiError)) return 'failed'; // network
  if (error.status === 401) return 'unauthenticated';
  if (error.status === 403) return 'forbidden';
  if (error.status === 404) return 'notFound';
  if (error.status === 409) return 'capReached';
  if (error.status === 422) return error.detail === 'unknown_area' ? 'areaInactive' : 'invalid';
  return 'failed';
}

const fieldNames: readonly string[] = FIELD_ORDER;

/** The fields of step 3 (the rest of `FIELD_ORDER` is step 2's). */
const PREFERENCE_FIELDS: readonly FieldName[] = [
  'accepted_households',
  'min_contract_months',
  'flatmates_count',
  'flatmate_ages',
];

/**
 * A 422 list `detail` as field errors: each item whose `loc` is exactly `["body", <field>]` names
 * that field. Only `loc` is read; FastAPI's `msg` is English and never shown. Model-level items
 * (`["body"]`) and fields without an error slot map to nothing.
 */
function serverFieldErrors(error: Error): FieldErrors {
  if (!(error instanceof ApiError)) return {};
  const detail: unknown = error.detail;
  if (!Array.isArray(detail)) return {};
  const found: FieldErrors = {};
  for (const item of detail as unknown[]) {
    if (typeof item !== 'object' || item === null || !('loc' in item)) continue;
    const loc: unknown = item.loc;
    if (!Array.isArray(loc) || loc.length !== 2 || loc[0] !== 'body') continue;
    const name: unknown = loc[1];
    if (typeof name === 'string' && fieldNames.includes(name)) {
      found[name as FieldName] = { key: 'listings.errors.invalid' };
    }
  }
  return found;
}

function CheckIcon() {
  return (
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
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

type Props = {
  /** Edit mode: the stored listing. The form starts from it and a save sends only what changed. */
  listing?: ListingOut;
  /** New listing only (`/listings/new?type=`, spec 0010a): the type is chosen, the type step is
   * skipped. */
  initialType?: ListingType;
};

/** Where a listing of `type` lives (spec 0010a): a room in the market's "שלי". */
function mineFor(type: ListingType | null): string {
  return type === 'room' ? '/market/mine' : '/me/listings';
}

/**
 * Type → details → preferences → preview → publish (or, with `listing`, → save). Everything
 * entered lives in this component's state only (no storage, no URL), so "back" keeps it and a
 * reload starts over. Edit mode and a preselected type start on details (`firstStep` 2) and never
 * show the type step; the steps shown are numbered from there ("1 of 3").
 */
export function ListingWizard({ listing, initialType }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [confirm, dialog] = useConfirm();

  // The listing as it was when the page opened. Every diff is against this, never the live prop:
  // a background refetch must neither overwrite what the owner typed nor add another tab's
  // changes to the PATCH body.
  const [base] = useState(() => listing);
  const editing = base !== undefined;

  const [firstStep] = useState<Step>(() => (editing || initialType !== undefined ? 2 : 1));
  const [step, setStep] = useState<Step>(firstStep);
  const [form, setForm] = useState<ListingForm>(() =>
    base === undefined
      ? { ...emptyForm, listing_type: initialType ?? null }
      : formFromListing(base),
  );
  // What is shown: step `firstStep` is "1", out of the steps from there on.
  const shown = step - firstStep + 1;
  const total = 5 - firstStep;
  // Where a save or a leave goes: the stored type in edit mode, else the chosen one.
  const mine = mineFor(base?.listing_type ?? form.listing_type);
  const [errors, setErrors] = useState<FieldErrors>({});
  // A 422 that names fields. Kept apart from `errors`, which re-validation rebuilds on every blur:
  // a server error stays until its own field changes or the next save.
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  // Validation runs on "next"; after the first attempt also on blur, never on each keystroke.
  const [attempted, setAttempted] = useState(false);
  // Step 3's "next" was pressed: from then on its errors come back with it after a round trip to
  // details. Before, a room's empty flatmates count would greet the owner as an error.
  const [preferencesAttempted, setPreferencesAttempted] = useState(false);

  const areas = useQuery({ queryKey: ['areas'], queryFn: fetchAreas });
  const create = useCreateListing();
  // Called in both modes (rules of hooks); only mutated when editing.
  const edit = usePatchListing(base?.id ?? '');
  const active = editing ? edit : create;
  const today = todayInIsrael();

  // One active area is preselected; a selection that is no longer offered is dropped.
  const withArea = (values: ListingForm): ListingForm => {
    let areaId = '';
    if (areas.data?.length === 1) areaId = areas.data[0]?.id ?? '';
    else if (areas.data?.some((area) => area.id === values.area_id)) areaId = values.area_id;
    return { ...values, area_id: areaId };
  };
  const current = withArea(form);

  // From `form`, not `current`: `withArea` gives `area_id: ''` while the areas load, which would
  // mark an untouched form as changed.
  const dirty =
    base !== undefined && Object.keys(changedFields(base, toListingIn(form))).length > 0;

  // Reload or tab close while dirty: the browser asks (with its own text).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const fieldId = (name: FieldName) => `${id}-${name}`;

  // A new step starts at its heading (keyboard and screen-reader users land at the top), or at
  // the field a server error names (`focusAfterStep`, set before the step changes).
  const firstRender = useRef(true);
  const focusAfterStep = useRef<string | null>(null);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const target = focusAfterStep.current;
    focusAfterStep.current = null;
    const element = target === null ? null : document.getElementById(target);
    (element ?? headingRef.current)?.focus();
  }, [step]);

  function update(patch: Partial<ListingForm>) {
    const next = { ...form, ...patch };
    setForm(next);
    // A new type starts step 3's validation over: the room block has not been "attempted" yet.
    if (patch.listing_type !== undefined && patch.listing_type !== form.listing_type) {
      setPreferencesAttempted(false);
    }
    // The count and the ages are one question: a server error on either goes with a new count.
    const touched = new Set<string>(Object.keys(patch));
    if (touched.has('flatmates_count')) {
      touched.add('flatmate_ages');
    }
    if ([...touched].some((name) => name in serverErrors)) {
      setServerErrors((shown) => {
        const kept: FieldErrors = {};
        for (const name of FIELD_ORDER) {
          const error = shown[name];
          if (error !== undefined && !touched.has(name)) kept[name] = error;
        }
        return kept;
      });
    }
    // After the first attempt a shown error goes (or changes) as soon as its field is fixed, so
    // nothing below it moves on the blur that a click on the next control causes. New errors still
    // wait for blur or "next".
    if (attempted) {
      const found = { ...validate(withArea(next), today), ...validatePreferences(next) };
      setErrors((shown) => {
        const kept: FieldErrors = {};
        for (const name of FIELD_ORDER) {
          const error = found[name];
          if (shown[name] !== undefined && error !== undefined) kept[name] = error;
        }
        return kept;
      });
    }
  }

  function goTo(next: Step) {
    create.reset();
    edit.reset();
    setStep(next);
  }

  // `disabled={isPending}` only takes effect after a re-render; a same-tick double click (or Enter
  // twice) would send two POSTs and create two listings.
  const publishing = useRef(false);

  function onSaveError(error: Error) {
    const kind = outcome(error);
    // The session is gone or the role changed: /me is stale either way.
    if (kind === 'unauthenticated') queryClient.setQueryData<UserOut | null>(ME_KEY, null);
    if (kind === 'forbidden') void queryClient.invalidateQueries({ queryKey: ME_KEY, exact: true });
    // Not this owner's listing (any more): drop it from the list now, so the edit page shows
    // "not found" without waiting for the refetch.
    if (kind === 'notFound' && base !== undefined) {
      queryClient.setQueryData<MyListingOut[]>(MY_LISTINGS_KEY, (old) =>
        old?.filter((l) => l.id !== base.id),
      );
      void queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
    }
    if (kind === 'invalid') {
      const found = serverFieldErrors(error);
      const first = firstInvalid(found);
      if (first !== undefined) {
        setServerErrors(found);
        focusAfterStep.current = fieldId(first);
        // Details fields come first in FIELD_ORDER: a 422 naming both kinds lands on details.
        goTo(PREFERENCE_FIELDS.includes(first) ? 3 : 2);
      }
    }
  }

  // A save starting clears them (no re-render when there are none).
  function clearServerErrors() {
    if (Object.keys(serverErrors).length > 0) setServerErrors({});
  }

  function publish() {
    if (publishing.current) return;
    const settle = {
      onSettled: () => {
        publishing.current = false;
      },
      onError: onSaveError,
    };
    if (base === undefined) {
      publishing.current = true;
      clearServerErrors();
      create.mutate(toListingIn(current), {
        ...settle,
        onSuccess: () => navigate(mine, { state: { published: true } }),
      });
      return;
    }
    const body = changedFields(base, toListingIn(current));
    if (Object.keys(body).length === 0) {
      navigate(mine);
      return;
    }
    publishing.current = true;
    clearServerErrors();
    edit.mutate(body, {
      ...settle,
      onSuccess: () => navigate(mine, { state: { saved: true } }),
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === 1) {
      if (form.listing_type !== null) goTo(2);
    } else if (step === 2 || step === 3) {
      const found = step === 2 ? validate(current, today) : validatePreferences(current);
      // A preferences error survives a round trip to details (`found` alone decides the step).
      setErrors(
        step === 2
          ? { ...found, ...(preferencesAttempted ? validatePreferences(current) : {}) }
          : found,
      );
      setAttempted(true);
      if (step === 3) setPreferencesAttempted(true);
      const first = firstInvalid(found);
      if (first === undefined) {
        goTo(step === 2 ? 3 : 4);
        return;
      }
      // The area may have no input (no areas, or a load error): focus the next field that has one.
      const start = FIELD_ORDER.indexOf(first);
      for (const name of FIELD_ORDER.slice(start)) {
        const element = found[name] && document.getElementById(fieldId(name));
        if (element) {
          element.focus();
          break;
        }
      }
    } else {
      publish();
    }
  }

  const failure = active.error ? outcome(active.error) : null;
  if (failure === 'unauthenticated') return <Navigate to="/login" replace />;
  if (failure === 'forbidden') return <Navigate to="/" replace />;

  // The internal steps from `firstStep` on: the type step only when it is reachable.
  const steps = [
    t('listings.steps.type'),
    t('listings.steps.details'),
    t('listings.steps.preferences'),
    t('listings.steps.preview'),
  ].slice(firstStep - 1);

  const room = form.listing_type === 'room';
  let heading: string;
  let hint: string | null = null;
  if (step === 1) {
    heading = t('listings.stepTitle.type');
  } else if (step === 2) {
    heading = t(room ? 'listings.stepTitle.detailsRoom' : 'listings.stepTitle.details');
    hint = t('listings.stepHint.details');
  } else if (step === 3) {
    heading = t(room ? 'listings.prefs.titleRoom' : 'listings.prefs.title');
    hint = t('listings.prefs.hint');
  } else {
    heading = t(editing ? 'listings.stepTitle.previewEdit' : 'listings.stepTitle.preview');
    hint = t('listings.preview.hint');
  }

  const chevron = (path: string) => (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="ltr:rotate-180"
    >
      <path d={path} />
    </svg>
  );

  return (
    <>
      <form
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-6 lg:grid lg:grid-cols-[theme(spacing.72)_minmax(0,theme(maxWidth.2xl))] lg:justify-center lg:gap-x-8 lg:gap-y-6"
      >
        <div className="-mx-4 -mt-6 border-b border-border bg-surface px-4 pb-4 pt-3 md:-mx-6 md:px-6 lg:contents">
          <div className="mx-auto flex w-full max-w-narrow flex-col gap-4 lg:contents">
            <PageHeader
              size="compact"
              title={editing ? t('listings.edit.title') : t('listings.new.title')}
              titleRef={headingRef}
              titleId={`${id}-title`}
              back={
                editing
                  ? {
                      to: mine,
                      label:
                        mine === '/market/mine'
                          ? t('market.mine.back')
                          : t('listings.edit.backToMine'),
                      onClick: (event) => {
                        // A clean form leaves; a dirty one asks first (the link is followed only
                        // once the dialog resolves `true`).
                        if (!dirty) return;
                        event.preventDefault();
                        void confirm({
                          title: t('listings.edit.leaveConfirm'),
                          confirmLabel: t('listings.edit.leave'),
                          cancelLabel: t('listings.edit.stay'),
                          tone: 'danger',
                        }).then((leave) => {
                          if (leave) void navigate(mine);
                        });
                      },
                    }
                  : undefined
              }
              className="lg:col-span-2"
            />
            <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:col-start-1 lg:row-start-2 lg:self-start lg:rounded-lg lg:border lg:border-border lg:bg-surface lg:p-6">
              <ol className="flex items-start justify-between gap-1 lg:flex-col lg:items-stretch lg:gap-3">
                {steps.map((name, i) => {
                  const n = i + 1;
                  const done = n < shown;
                  const isCurrent = n === shown;
                  return (
                    <li
                      key={name}
                      aria-current={isCurrent ? 'step' : undefined}
                      className="flex flex-1 flex-col items-center gap-2 lg:flex-none lg:flex-row lg:items-center lg:gap-3"
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                          done
                            ? 'bg-ink text-on-ink'
                            : isCurrent
                              ? 'border-2 border-accent bg-surface text-caption font-semibold text-accent'
                              : 'border-2 border-border-strong bg-surface text-caption text-ink-muted'
                        }`}
                      >
                        {done ? <CheckIcon /> : n}
                      </span>
                      <span
                        className={`text-caption lg:text-label ${
                          isCurrent
                            ? 'font-semibold text-ink lg:font-semibold'
                            : done
                              ? 'text-ink'
                              : 'text-ink-muted'
                        }`}
                      >
                        {name}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <div
                role="progressbar"
                aria-valuenow={shown}
                aria-valuemin={1}
                aria-valuemax={total}
                aria-labelledby={`${id}-title`}
                className="flex h-1 overflow-hidden rounded-full bg-border"
              >
                <div
                  className="rounded-full bg-accent transition-all motion-reduce:transition-none"
                  style={{ width: `${String((shown / total) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-start-2">
          <div
            onBlur={() => {
              if (step === 2 && attempted) setErrors(validate(current, today));
            }}
            className="mx-auto flex w-full max-w-narrow flex-col gap-6 lg:max-w-none"
          >
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-h2">{heading}</h2>
              <p className="text-body-sm text-ink-muted">
                <span>{t('listings.stepOf', { n: shown, total })}</span>
                {hint !== null && (
                  <>
                    {' · '}
                    <span>{hint}</span>
                  </>
                )}
              </p>
            </div>
            {step === 1 && (
              <TypeStep
                value={form.listing_type}
                onChange={(listing_type) => update({ listing_type })}
              />
            )}
            {step === 2 && (
              <DetailsStep
                form={current}
                onChange={update}
                errors={{ ...serverErrors, ...errors }}
                areas={areas}
                today={today}
                fieldId={fieldId}
              />
            )}
            {step === 3 && (
              <PreferencesStep
                form={current}
                onChange={update}
                errors={{ ...serverErrors, ...errors }}
                fieldId={fieldId}
              />
            )}
            {step === 4 && (
              <PreviewStep
                body={toListingIn(current)}
                today={today}
                // A 404 while editing unmounts the wizard (the page shows "not found").
                error={failure === 'notFound' ? 'failed' : failure}
                onRetry={publish}
                onBackToDetails={() => {
                  // The chosen area was deactivated: offer the current list.
                  void queryClient.invalidateQueries({ queryKey: ['areas'] });
                  goTo(2);
                }}
              />
            )}
          </div>

          <div
            data-sticky-footer
            className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-surface px-4 pt-3 pb-[max(theme(spacing.6),env(safe-area-inset-bottom))] md:-mx-6 md:px-6 lg:bottom-4 lg:mx-0 lg:rounded-lg lg:border lg:px-4 lg:pb-3"
          >
            <div className="mx-auto flex w-full max-w-narrow gap-3 lg:max-w-none lg:justify-between">
              {step > firstStep && (
                <Button
                  variant="secondary"
                  size="lg"
                  type="button"
                  onClick={() => goTo((step - 1) as Step)}
                  icon={chevron('M9 6l6 6-6 6')}
                  className="basis-2/5 lg:flex-none lg:basis-auto"
                >
                  {t('common.back')}
                </Button>
              )}
              <Button
                variant="primary"
                size="lg"
                type="submit"
                disabled={(step === 1 && form.listing_type === null) || active.isPending}
                aria-busy={active.isPending}
                className="flex-1 lg:ms-auto lg:min-w-48 lg:flex-none"
              >
                {step < 4
                  ? t('listings.next')
                  : editing
                    ? t('listings.save')
                    : t('listings.publish')}
                {step < 4 && chevron('M15 6l-6 6 6 6')}
              </Button>
            </div>
          </div>
        </div>
      </form>
      {dialog}
    </>
  );
}
