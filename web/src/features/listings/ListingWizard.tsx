import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';

import type { UserOut } from '../../api/client';
import { fetchAreas } from '../areas/api';
import { ME_KEY } from '../auth/useMe';
import { ApiError } from './api';
import { DetailsStep } from './DetailsStep';
import { todayInIsrael } from './format';
import { PreviewStep, type PublishError } from './PreviewStep';
import { TypeStep } from './TypeStep';
import { useCreateListing } from './useCreateListing';
import {
  emptyForm,
  firstInvalid,
  FIELD_ORDER,
  toListingIn,
  validate,
  type FieldErrors,
  type FieldName,
  type ListingForm,
} from './validate';

type Step = 1 | 2 | 3;
type Outcome = PublishError | 'unauthenticated' | 'forbidden';

function outcome(error: Error): Outcome {
  if (!(error instanceof ApiError)) return 'failed'; // network
  if (error.status === 401) return 'unauthenticated';
  if (error.status === 403) return 'forbidden';
  if (error.status === 409) return 'capReached';
  if (error.status === 422) return error.detail === 'unknown_area' ? 'areaInactive' : 'invalid';
  return 'failed';
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
      stroke="#FFFFFF"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}

/**
 * Type → details → preview → publish. Everything entered lives in this component's state only (no
 * storage, no URL), so "back" keeps it and a reload starts over.
 */
export function ListingWizard() {
  const { t } = useTranslation();
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<ListingForm>(emptyForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  // Validation runs on "next"; after the first attempt also on blur, never on each keystroke.
  const [attempted, setAttempted] = useState(false);

  const areas = useQuery({ queryKey: ['areas'], queryFn: fetchAreas });
  const create = useCreateListing();
  const today = todayInIsrael();

  // One active area is preselected; a selection that is no longer offered is dropped.
  const withArea = (values: ListingForm): ListingForm => {
    let areaId = '';
    if (areas.data?.length === 1) areaId = areas.data[0]?.id ?? '';
    else if (areas.data?.some((area) => area.id === values.area_id)) areaId = values.area_id;
    return { ...values, area_id: areaId };
  };
  const current = withArea(form);

  const fieldId = (name: FieldName) => `${id}-${name}`;

  // A new step starts at its heading (keyboard and screen-reader users land at the top).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  function update(patch: Partial<ListingForm>) {
    const next = { ...form, ...patch };
    setForm(next);
    // After the first attempt a shown error goes (or changes) as soon as its field is fixed, so
    // nothing below it moves on the blur that a click on the next control causes. New errors still
    // wait for blur or "next".
    if (attempted) {
      const found = validate(withArea(next), today);
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
    setStep(next);
  }

  function publish() {
    create.mutate(toListingIn(current), {
      onSuccess: () => navigate('/me/listings'),
      onError: (error) => {
        const kind = outcome(error);
        // The session is gone or the role changed: /me is stale either way.
        if (kind === 'unauthenticated') queryClient.setQueryData<UserOut | null>(ME_KEY, null);
        if (kind === 'forbidden')
          void queryClient.invalidateQueries({ queryKey: ME_KEY, exact: true });
      },
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === 1) {
      if (form.listing_type !== null) goTo(2);
    } else if (step === 2) {
      const found = validate(current, today);
      setErrors(found);
      setAttempted(true);
      const first = firstInvalid(found);
      if (first === undefined) {
        goTo(3);
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
    } else if (!create.isPending) {
      publish();
    }
  }

  const failure = create.error ? outcome(create.error) : null;
  if (failure === 'unauthenticated') return <Navigate to="/login" replace />;
  if (failure === 'forbidden') return <Navigate to="/" replace />;

  const steps = [
    t('listings.steps.type'),
    t('listings.steps.details'),
    t('listings.steps.preview'),
  ];

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1
          ref={headingRef}
          id={`${id}-title`}
          tabIndex={-1}
          className="text-start text-2xl font-extrabold focus:outline-none"
        >
          {t('listings.new.title')}
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
                        ? 'border-[2.5px] border-accent bg-white font-extrabold text-accent-text'
                        : 'border-2 border-[#D6D3D1] bg-white font-bold text-muted'
                  }`}
                >
                  {done ? <CheckIcon /> : n}
                </span>
                <span
                  className={`text-xs ${
                    done
                      ? 'font-semibold text-accent-text'
                      : isCurrent
                        ? 'font-bold text-ink'
                        : 'font-medium text-muted'
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
          aria-valuemax={3}
          aria-labelledby={`${id}-title`}
          className="flex h-1 overflow-hidden rounded-full bg-line"
        >
          <div
            className="rounded-full bg-accent transition-[width]"
            style={{ width: `${String((step / 3) * 100)}%` }}
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
            errors={errors}
            areas={areas}
            today={today}
            fieldId={fieldId}
          />
        )}
        {step === 3 && (
          <PreviewStep
            body={toListingIn(current)}
            today={today}
            error={failure}
            onRetry={publish}
            onBackToDetails={() => {
              // The chosen area was deactivated: offer the current list.
              void queryClient.invalidateQueries({ queryKey: ['areas'] });
              goTo(2);
            }}
          />
        )}
      </div>

      <div className="sticky bottom-0 -mx-4 flex gap-[10px] border-t border-line bg-white px-4 pb-[22px] pt-3">
        {step > 1 && (
          <button
            type="button"
            onClick={() => goTo(step === 3 ? 2 : 1)}
            className={`flex min-h-[52px] flex-1 items-center justify-center gap-[6px] rounded-[14px] border-[1.5px] border-[#D6D3D1] bg-white text-[15px] font-bold ${focusRing}`}
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
          disabled={(step === 1 && form.listing_type === null) || create.isPending}
          aria-busy={create.isPending}
          className={`flex min-h-[52px] flex-[1.6] items-center justify-center gap-[6px] rounded-[14px] bg-accent text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
        >
          {step === 3 ? t('listings.publish') : t('listings.next')}
          {step < 3 && (
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
