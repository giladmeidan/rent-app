import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, type LinkProps } from 'react-router';

import type { UserOut } from '../../api/client';
import { fetchAreas } from '../areas/api';
import { ME_KEY } from '../auth/useMe';
import { ApiError, type ListingOut, type MyListingOut } from './api';
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

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className="text-on-ink"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

/** The link back to "my listings" (the edit wizard and the edit page's not-found state). */
export function BackToMine({ onClick }: { onClick?: LinkProps['onClick'] }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/me/listings"
      onClick={onClick}
      className={`inline-flex min-h-[44px] items-center gap-1 self-start rounded-full pe-3 text-[15px] font-semibold text-accent-strong ${focusRing}`}
    >
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
      {t('listings.edit.backToMine')}
    </Link>
  );
}

type Props = {
  /** Edit mode: the stored listing. The form starts from it and a save sends only what changed. */
  listing?: ListingOut;
};

/**
 * Type → details → preferences → preview → publish (or, with `listing`, → save). Everything
 * entered lives in this component's state only (no storage, no URL), so "back" keeps it and a
 * reload starts over.
 */
export function ListingWizard({ listing }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The listing as it was when the page opened. Every diff is against this, never the live prop:
  // a background refetch must neither overwrite what the owner typed nor add another tab's
  // changes to the PATCH body.
  const [base] = useState(() => listing);
  const editing = base !== undefined;

  const [step, setStep] = useState<Step>(editing ? 2 : 1);
  const [form, setForm] = useState<ListingForm>(() =>
    base === undefined ? emptyForm : formFromListing(base),
  );
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
        onSuccess: () => navigate('/me/listings'),
      });
      return;
    }
    const body = changedFields(base, toListingIn(current));
    if (Object.keys(body).length === 0) {
      navigate('/me/listings');
      return;
    }
    publishing.current = true;
    clearServerErrors();
    edit.mutate(body, {
      ...settle,
      onSuccess: () => navigate('/me/listings', { state: { saved: true } }),
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

  const steps = [
    t('listings.steps.type'),
    t('listings.steps.details'),
    t('listings.steps.preferences'),
    t('listings.steps.preview'),
  ];

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        {editing && (
          <BackToMine
            onClick={(event) => {
              if (dirty && !window.confirm(t('listings.edit.leaveConfirm'))) {
                event.preventDefault();
              }
            }}
          />
        )}
        <h1
          ref={headingRef}
          id={`${id}-title`}
          tabIndex={-1}
          className="text-start text-2xl font-extrabold focus:outline-none"
        >
          {editing ? t('listings.edit.title') : t('listings.new.title')}
        </h1>
        <ol className="flex items-start justify-between gap-1">
          {steps.map((name, i) => {
            const n = i + 1;
            const done = n < step;
            const isCurrent = n === step;
            return (
              <li
                key={name}
                aria-current={isCurrent ? 'step' : undefined}
                className="flex flex-1 flex-col items-center gap-[6px]"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[13px] ${
                    done
                      ? 'bg-accent'
                      : isCurrent
                        ? 'border-[2.5px] border-accent bg-surface font-extrabold text-accent-strong'
                        : 'border-2 border-border-strong bg-surface font-bold text-ink-muted'
                  }`}
                >
                  {done ? <CheckIcon /> : n}
                </span>
                <span
                  className={`text-xs ${
                    done
                      ? 'font-semibold text-accent-strong'
                      : isCurrent
                        ? 'font-bold text-ink'
                        : 'font-medium text-ink-muted'
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
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={4}
          aria-labelledby={`${id}-title`}
          className="flex h-1 overflow-hidden rounded-full bg-border"
        >
          <div
            className="rounded-full bg-accent transition-[width]"
            style={{ width: `${String((step / 4) * 100)}%` }}
          />
        </div>
      </div>

      <div
        onBlur={() => {
          if (step === 2 && attempted) setErrors(validate(current, today));
        }}
      >
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

      <div className="sticky bottom-0 -mx-4 flex gap-[10px] border-t border-border bg-surface px-4 pb-[22px] pt-3">
        {step > 1 && (
          <button
            type="button"
            onClick={() => goTo((step - 1) as Step)}
            className={`flex min-h-[52px] flex-1 items-center justify-center gap-[6px] rounded-[14px] border-[1.5px] border-border-strong bg-surface text-[15px] font-bold ${focusRing}`}
          >
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
            >
              <path d="M9 6l6 6-6 6" />
            </svg>
            {t('common.back')}
          </button>
        )}
        <button
          type="submit"
          disabled={(step === 1 && form.listing_type === null) || active.isPending}
          aria-busy={active.isPending}
          className={`flex min-h-[52px] flex-[1.6] items-center justify-center gap-[6px] rounded-[14px] bg-accent text-base font-bold text-on-ink disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
        >
          {step < 4 ? t('listings.next') : editing ? t('listings.save') : t('listings.publish')}
          {step < 4 && (
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
            >
              <path d="M15 6l-6 6 6 6" />
            </svg>
          )}
        </button>
      </div>
    </form>
  );
}
