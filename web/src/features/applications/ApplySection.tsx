import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { useMe } from '../auth/useMe';
import { ApiError, type ListingDetail } from '../listings/api';
import { useProfile } from '../profile/useProfile';
import { RoomGate } from '../rooms/RoomGate';
import { hasStatus, type MyApplicationOut } from './api';
import { ApplicationStatusChip } from './ApplicationStatusChip';
import { appliedOn } from './format';
import { ProfileGate } from './ProfileGate';
import { loginPath, useApply } from './useApply';
import { useMyApplications } from './useMyApplications';

/** The API's message limit (PRODUCT.md "Applications", 1-500 characters). */
const MESSAGE_MAX = 500;
/** The counter is announced only near the limit. */
const ANNOUNCE_BELOW = 50;

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const primary = `inline-flex min-h-[52px] items-center justify-center rounded-[14px] bg-accent px-5 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;
const secondary = `inline-flex min-h-[52px] items-center justify-center rounded-[14px] border-[1.5px] border-[#D6D3D1] bg-white px-5 text-[15px] font-bold text-ink ${focusRing}`;
const textarea =
  'w-full rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-3 py-3 text-start text-base text-ink focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-tint aria-[invalid=true]:border-[#B91C1C]';
const fieldError = 'text-sm font-semibold text-[#B91C1C]';
const hint = 'text-xs text-muted';

/** True when a FastAPI 422 `detail` list has an item at `loc` `["body", "message"]`. */
function isMessageError(detail: unknown): boolean {
  return (
    Array.isArray(detail) &&
    detail.some((item: unknown) => {
      if (typeof item !== 'object' || item === null || !('loc' in item)) return false;
      const loc: unknown = item.loc;
      return Array.isArray(loc) && loc.length === 2 && loc[0] === 'body' && loc[1] === 'message';
    })
  );
}

type Apply = ReturnType<typeof useApply>;

/** The empty state: the apply button, and the message form it discloses. */
function ApplyForm({ apply }: { apply: Apply }) {
  const { t } = useTranslation();
  const id = useId();
  const formId = `${id}-form`;
  const fieldId = `${id}-message`;
  const hintId = `${id}-hint`;
  const counterId = `${id}-counter`;
  const errorId = `${id}-error`;
  const serverErrorId = `${id}-server-error`;

  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [fieldErr, setFieldErr] = useState<'required' | 'invalid' | null>(null);
  const [serverErr, setServerErr] = useState<'rateLimited' | 'failed' | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Same-tick guard: a double click sends one request (every attempt counts toward the limit).
  const inFlight = useRef(false);
  const lastBody = useRef('');

  useEffect(() => {
    if (open) fieldRef.current?.focus();
  }, [open]);

  function send(body: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    lastBody.current = body;
    setServerErr(null);
    apply.mutate(body, {
      onSettled: () => {
        inFlight.current = false;
      },
      onError: (error) => {
        // 401 (log in and come back) and every 409 (`already_applied`, `seeker_profile_required`,
        // and a room's `seeker_gender_required` / `room_gender_mismatch`) are the hook's: the
        // controls it swaps in are the feedback.
        if (hasStatus(error, 401) || hasStatus(error, 409)) return;
        // 404 removes the form; every other error keeps it, with focus back on the text.
        if (hasStatus(error, 404)) {
          setUnavailable(true);
          return;
        }
        if (hasStatus(error, 429)) setServerErr('rateLimited');
        else if (
          error instanceof ApiError &&
          error.status === 422 &&
          isMessageError(error.detail)
        ) {
          setFieldErr('invalid');
        } else setServerErr('failed');
        fieldRef.current?.focus();
      },
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const body = message.trim();
    if (body === '') {
      setFieldErr('required');
      fieldRef.current?.focus();
      return;
    }
    setFieldErr(null);
    send(body);
  }

  function onCancel() {
    setOpen(false);
    setMessage('');
    setFieldErr(null);
    setServerErr(null);
    buttonRef.current?.focus();
  }

  if (unavailable) {
    return (
      <p role="alert" className={fieldError}>
        {t('applications.errors.unavailable')}
      </p>
    );
  }

  const left = MESSAGE_MAX - message.length;
  const describedBy = [
    hintId,
    counterId,
    fieldErr !== null ? errorId : null,
    serverErr !== null ? serverErrorId : null,
  ]
    .filter((x) => x !== null)
    .join(' ');

  return (
    <div className="flex flex-col gap-3">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => setOpen((o) => !o)}
        className={`${primary} w-full`}
      >
        {t('applications.apply')}
      </button>
      {open && (
        <form id={formId} noValidate onSubmit={onSubmit} className="flex flex-col gap-[6px]">
          <label htmlFor={fieldId} className="text-sm font-bold">
            {t('applications.form.label')}
          </label>
          <textarea
            ref={fieldRef}
            id={fieldId}
            rows={5}
            maxLength={MESSAGE_MAX}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setFieldErr(null);
              // Retry re-sends the last body, so it is offered only while the text is unchanged.
              setServerErr(null);
            }}
            aria-invalid={fieldErr !== null}
            aria-describedby={describedBy}
            className={textarea}
          />
          <p id={hintId} className={hint}>
            {t('applications.form.hint')}
          </p>
          <p
            id={counterId}
            className={hint}
            aria-live={left <= ANNOUNCE_BELOW ? 'polite' : undefined}
          >
            {t('listings.fields.charsLeft', { count: left })}
          </p>
          {fieldErr !== null && (
            <p id={errorId} role="alert" className={fieldError}>
              {fieldErr === 'required'
                ? t('listings.errors.required')
                : t('listings.errors.invalid')}
            </p>
          )}
          {serverErr === 'rateLimited' && (
            <p id={serverErrorId} role="alert" className={fieldError}>
              {t('applications.errors.rateLimited')}
            </p>
          )}
          {serverErr === 'failed' && (
            <div id={serverErrorId}>
              <ErrorState onRetry={() => send(lastBody.current)} />
            </div>
          )}
          <div className="flex flex-wrap gap-[10px] pt-2">
            <button
              type="submit"
              disabled={apply.isPending}
              aria-busy={apply.isPending}
              className={`${primary} flex-[1.4]`}
            >
              {t('applications.form.submit')}
            </button>
            <button type="button" onClick={onCancel} className={`${secondary} flex-1`}>
              {t('applications.form.cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** The applied state: when, the status, and the way to "my applications". */
function Applied({ application }: { application: MyApplicationOut }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {application.source === 'like' ? (
          <p
            data-testid="application-mutual"
            className="rounded-full border border-accent-tint bg-accent-tint px-3 py-[6px] text-[13px] font-semibold text-accent-text"
          >
            {t('applications.mutual')}
          </p>
        ) : (
          <p className="text-start text-[15px] font-semibold">
            {t('applications.applied', { date: appliedOn(application.created_at) })}
          </p>
        )}
        <ApplicationStatusChip status={application.status} />
      </div>
      {application.status === 'declined' && (
        <p className="text-start text-sm text-muted">{t('applications.declinedHint')}</p>
      )}
      <Link
        to="/me/applications"
        className={`inline-flex min-h-[44px] items-center rounded-full text-[15px] font-semibold text-accent-text underline underline-offset-4 ${focusRing}`}
      >
        {t('applications.viewMine')}
      </Link>
    </div>
  );
}

/**
 * The listing page's apply section: the applicant count for everyone, then the visitor prompt,
 * nothing (an owner), or the seeker's applied state or apply form. A room adds two states (0007f):
 * one that cannot take this seeker (`room_fit: false`), and a women- or men-only room that needs
 * the profile's room section first.
 */
export function ApplySection({ listing }: { listing: ListingDetail }) {
  const { t } = useTranslation();
  const headingId = useId();
  const me = useMe();
  const isSeeker = me.data?.role === 'seeker';
  // A visitor or an owner never requests the seeker's list or profile.
  const mine = useMyApplications(isSeeker);
  const profile = useProfile(isSeeker);
  const apply = useApply(listing.id);

  const countLine = t('applications.count', { count: listing.applicant_count });

  const visitor = (
    <div className="flex flex-col items-start gap-3">
      <p className="text-start text-[15px]">{t('applications.loginPrompt')}</p>
      <div className="flex flex-wrap gap-[10px]">
        <Link to={loginPath(listing.id)} className={primary}>
          {t('header.login')}
        </Link>
        <Link
          to={`/signup?role=seeker&next=${encodeURIComponent(`/listings/${listing.id}`)}`}
          className={secondary}
        >
          {t('header.signup')}
        </Link>
      </div>
    </div>
  );

  const skeleton = (
    <div aria-busy="true" aria-label={t('common.loading')}>
      <Skeleton className="h-[52px] w-full" />
    </div>
  );
  const application = mine.data?.find((a) => a.listing.id === listing.id);
  const live = application !== undefined && application.status !== 'withdrawn';

  let controls;
  if (me.isPending || (isSeeker && mine.isPending)) {
    controls = skeleton;
  } else if (
    me.data === null ||
    (me.isError && me.data === undefined) ||
    hasStatus(mine.error, 401) ||
    hasStatus(profile.error, 401)
  ) {
    // A failed first /me renders the logged-out state, as the header does; a failed background
    // refetch keeps the cached person (and an open form). A 401 on the list or the profile clears
    // the session (useMyApplications, useProfile), which lands here too.
    controls = visitor;
  } else if (!isSeeker) {
    controls = null;
  } else if (mine.isError && mine.data === undefined) {
    // Only when nothing is cached: a failed background refetch keeps the list and the draft.
    controls = <ErrorState onRetry={() => void mine.refetch()} />;
  } else if (live) {
    // An application to this listing never waits for the profile.
    controls = (
      <div className="flex flex-col items-start gap-2">
        {apply.isSuccess && (
          <p role="status" className="text-start text-[15px] font-bold text-accent-text">
            {t('applications.sent')}
          </p>
        )}
        <Applied application={application} />
      </div>
    );
  } else if (listing.room_fit === false) {
    // The API's answer for this seeker; it needs no profile request. No link: the cause may be
    // the room's preference or the seeker's own, and the line nudges no one to change either.
    controls = <p className="text-start text-[15px]">{t('rooms.apply.misfit')}</p>;
  } else if (profile.isPending) {
    controls = skeleton;
  } else if (profile.isError && profile.data === undefined) {
    controls = <ErrorState onRetry={() => void profile.refetch()} />;
  } else if (
    listing.listing_type === 'room' &&
    listing.gender_preference !== 'any' &&
    (profile.data === null || profile.data.gender === null)
  ) {
    // Before `ProfileGate`: the room section's page also creates the housing profile.
    controls = <RoomGate listing={listing} />;
  } else if (profile.data === null) {
    controls = <ProfileGate listingId={listing.id} />;
  } else {
    controls = <ApplyForm apply={apply} />;
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-[17px] font-extrabold">
        {t('applications.heading')}
      </h2>
      <p className="text-start text-[15px] text-muted">{countLine}</p>
      {controls}
    </section>
  );
}
