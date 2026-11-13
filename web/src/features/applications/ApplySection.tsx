import { useEffect, useId, useRef, useState, type FormEvent, type Ref } from 'react';
import { useTranslation } from 'react-i18next';

import { clearDraft, readDraft, writeDraft } from '../../app/drafts';
import { Button } from '../../components/Button';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { retryAfterText } from '../../components/retryAfter';
import { Skeleton } from '../../components/Skeleton';
import { Field } from '../../components/Field';
import { Tag } from '../../components/Tag';
import { Textarea } from '../../components/Textarea';
import { useMe } from '../auth/useMe';
import { ApiError, type ListingDetail } from '../listings/api';
import { hasLooking } from '../profile/api';
import { useProfile } from '../profile/useProfile';
import { RoomGate } from '../rooms/RoomGate';
import { hasStatus, type MyApplicationOut } from './api';
import { ApplicationStatusChip } from './ApplicationStatusChip';
import { canApply } from './canApply';
import { appliedOn } from './format';
import { ProfileGate } from './ProfileGate';
import { loginPath, useApply } from './useApply';
import { useMyApplications } from './useMyApplications';

/** The API's message limit (PRODUCT.md "Applications", 1-500 characters). */
const MESSAGE_MAX = 500;
/** The counter is announced only near the limit. */
const ANNOUNCE_BELOW = 50;

const fieldError = 'text-body-sm font-semibold text-danger';
const hint = 'text-caption text-ink-muted';

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

/** What the section shows below its count line. */
type Branch =
  | 'loading'
  | 'visitor'
  | 'none'
  | 'own'
  | 'error'
  | 'applied'
  | 'misfit'
  | 'roomGate'
  | 'profileGate'
  | 'form';
/** The branches that take focus when they replace the form after a submit. */
const FOCUSED_BRANCHES = new Set<Branch>(['applied', 'misfit', 'roomGate', 'profileGate']);

/**
 * The empty state: the apply button, and the message form it discloses. `onSubmitted(true)` runs
 * before every request, so the section can move focus to whatever replaces the form (spec 0009t);
 * `onSubmitted(false)` after an answer that keeps the form, so a later swap takes no focus.
 *
 * The message is kept as `userId`'s draft in this tab (spec 0009g): a form mounted with a draft
 * opens with it, without taking focus. Cancel clears it; `useApply` clears it on the final answers.
 */
function ApplyForm({
  apply,
  listingId,
  userId,
  onSubmitted,
}: {
  apply: Apply;
  listingId: string;
  /** The signed-in seeker, whose draft this is. */
  userId: string | undefined;
  onSubmitted: (submitted: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const formId = `${id}-form`;
  const fieldId = `${id}-message`;
  const counterId = `${id}-counter`;
  const serverErrorId = `${id}-server-error`;

  // Read once, on mount: a saved draft opens the form with its text.
  const [draft] = useState(() => readDraft('apply', listingId, userId));
  const [open, setOpen] = useState(draft !== '');
  const [message, setMessage] = useState(draft);
  const [fieldErr, setFieldErr] = useState<'required' | 'invalid' | null>(null);
  const [serverErr, setServerErr] = useState<'rateLimited' | 'failed' | null>(null);
  // A 429's `Retry-After`, in seconds, when the API sent one.
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const unavailableRef = useRef<HTMLParagraphElement>(null);
  // Same-tick guard: a double click sends one request (every attempt counts toward the limit).
  const inFlight = useRef(false);
  const lastBody = useRef('');

  // Focus follows the person opening the form, never the mount: a form reopened from a draft
  // takes no focus (it would raise the mobile keyboard and fight `RouteFocus`).
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) fieldRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // A 404 replaces the form with its alert: focus follows.
  useEffect(() => {
    if (unavailable) unavailableRef.current?.focus();
  }, [unavailable]);

  function send(body: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    lastBody.current = body;
    setServerErr(null);
    onSubmitted(true);
    apply.mutate(body, {
      onSettled: () => {
        inFlight.current = false;
      },
      onError: (error) => {
        // 401 (log in and come back) and every 409 (`already_applied`, `seeker_profile_required`,
        // and a room's `seeker_gender_required` / `room_gender_mismatch`) are the hook's: the
        // controls it swaps in are the feedback.
        if (hasStatus(error, 401) || hasStatus(error, 409)) return;
        onSubmitted(false);
        // 404 removes the form; every other error keeps it, with focus back on the text.
        if (hasStatus(error, 404)) {
          setUnavailable(true);
          return;
        }
        if (hasStatus(error, 429)) {
          setRetryAfter(error instanceof ApiError ? error.retryAfter : null);
          setServerErr('rateLimited');
        } else if (
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
    clearDraft('apply', listingId);
    setOpen(false);
    setMessage('');
    setFieldErr(null);
    setServerErr(null);
    buttonRef.current?.focus();
  }

  if (unavailable) {
    return (
      <p
        ref={unavailableRef}
        tabIndex={-1}
        role="alert"
        className={`${fieldError} focus:outline-none`}
      >
        {t('applications.errors.unavailable')}
      </p>
    );
  }

  const left = MESSAGE_MAX - message.length;
  // `Field` puts its hint and error ids first; the counter and the server error follow.
  const describedBy = [counterId, serverErr !== null ? serverErrorId : null]
    .filter((x) => x !== null)
    .join(' ');

  return (
    <div className="flex flex-col gap-3">
      <Button
        ref={buttonRef}
        variant="primary"
        size="lg"
        fullWidth
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => setOpen((o) => !o)}
      >
        {t('applications.apply')}
      </Button>
      {open && (
        <form id={formId} noValidate onSubmit={onSubmit} className="flex flex-col gap-1.5">
          <Field
            id={fieldId}
            label={t('applications.form.label')}
            hint={t('applications.form.hint')}
            error={
              fieldErr === null
                ? undefined
                : fieldErr === 'required'
                  ? t('listings.errors.required')
                  : t('listings.errors.invalid')
            }
          >
            <Textarea
              ref={fieldRef}
              rows={5}
              maxLength={MESSAGE_MAX}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                writeDraft('apply', listingId, userId, e.target.value);
                setFieldErr(null);
                // Retry re-sends the last body, so it is offered only while the text is unchanged.
                setServerErr(null);
              }}
              aria-describedby={describedBy}
            />
          </Field>
          <p
            id={counterId}
            className={hint}
            aria-live={left <= ANNOUNCE_BELOW ? 'polite' : undefined}
          >
            {t('listings.fields.charsLeft', { count: left })}
          </p>
          {serverErr === 'rateLimited' && (
            <p id={serverErrorId} role="alert" className={fieldError}>
              {retryAfter !== null
                ? t('applications.errors.rateLimitedIn', { when: retryAfterText(t, retryAfter) })
                : t('applications.errors.rateLimited')}
            </p>
          )}
          {serverErr === 'failed' && (
            <div id={serverErrorId}>
              <ErrorState
                onRetry={() => {
                  // The box unmounts at once: focus waits in the text, not on <body>.
                  fieldRef.current?.focus();
                  send(lastBody.current);
                }}
              />
            </div>
          )}
          <div className="flex flex-wrap gap-2.5 pt-2">
            {/* `disabled`, not the kit's `busy`: the tests pin the attribute. */}
            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={apply.isPending}
              aria-busy={apply.isPending}
              className="flex-[1.4]"
            >
              {t('applications.form.submit')}
            </Button>
            <Button variant="secondary" size="lg" onClick={onCancel} className="flex-1">
              {t('applications.form.cancel')}
            </Button>
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
          <p tabIndex={-1} className="focus:outline-none">
            <Tag tone="accent" data-testid="application-mutual">
              {t('applications.mutual')}
            </Tag>
          </p>
        ) : (
          <p tabIndex={-1} className="text-start text-body font-semibold focus:outline-none">
            {t('applications.applied', { date: appliedOn(application.created_at) })}
          </p>
        )}
        <ApplicationStatusChip status={application.status} />
      </div>
      {application.status === 'declined' && (
        <p className="text-start text-body-sm text-ink-muted">{t('applications.declinedHint')}</p>
      )}
      <Button
        variant="ghost"
        to={application.listing.listing_type === 'room' ? '/market/mine' : '/me/applications'}
      >
        {t('applications.viewMine')}
      </Button>
    </div>
  );
}

/**
 * The listing page's apply section: the applicant count for everyone, then the visitor prompt,
 * the own-listing note (the caller's own listing, spec 0010b), nothing (a non-seeker on an
 * apartment), or the applicant's applied state or apply form (any account on a room, a seeker on
 * an apartment: `canApply`). A room adds two states (0007f):
 * one that cannot take this seeker (`room_fit: false`), and a women- or men-only room that needs
 * the profile's room section first.
 */
export function ApplySection({
  listing,
  headingRef,
}: {
  listing: ListingDetail;
  /** The section's `<h2>`, for the listing page's apply bar to move focus to. */
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const me = useMe();
  // The list and the profile are requested exactly when the form can show (spec 0010b).
  const mayApply = me.data != null && canApply(me.data, listing);
  // The lister's wording: their own listing, and an owner on any apartment (who cannot apply).
  const ownerView =
    listing.is_mine || (me.data?.role === 'owner' && listing.listing_type === 'apartment');
  const mine = useMyApplications(mayApply);
  const profile = useProfile(mayApply);
  const apply = useApply(listing.id);
  // A submit in this tab (spec 0009t): set by the form before each request, it lives here because
  // every swapping 409 unmounts the form. The branch that replaces the form then takes focus.
  const submitted = useRef(false);
  const controlsRef = useRef<HTMLDivElement>(null);

  const countLine = ownerView
    ? t('applications.countOwner', { count: listing.applicant_count })
    : t('applications.count', { count: listing.applicant_count });

  const visitor = (
    <div className="flex flex-col items-start gap-3">
      <p className="text-start text-body">{t('applications.loginPrompt')}</p>
      <div className="flex flex-wrap gap-2.5">
        <Button variant="primary" size="lg" to={loginPath(listing.id)}>
          {t('header.login')}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          to={`/signup?role=seeker&next=${encodeURIComponent(`/listings/${listing.id}`)}`}
        >
          {t('header.signup')}
        </Button>
      </div>
    </div>
  );

  const skeleton = (
    <Loading>
      <Skeleton className="h-13 w-full" />
    </Loading>
  );
  const application = mine.data?.find((a) => a.listing.id === listing.id);
  const live = application !== undefined && application.status !== 'withdrawn';

  let controls;
  let branch: Branch;
  if (me.isPending || (mayApply && mine.isPending)) {
    branch = 'loading';
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
    branch = 'visitor';
    controls = visitor;
  } else if (listing.is_mine) {
    branch = 'own';
    controls = (
      <div className="flex flex-col items-start gap-2">
        <p className="text-start text-body">{t('applications.own')}</p>
        <Button
          variant="ghost"
          to={listing.listing_type === 'room' ? '/market/mine' : '/me/listings'}
        >
          {t('applications.manage')}
        </Button>
      </div>
    );
  } else if (!mayApply) {
    // A signed-in non-seeker on an apartment (apartments keep the roles).
    branch = 'none';
    controls = null;
  } else if (mine.isError && mine.data === undefined) {
    // Only when nothing is cached: a failed background refetch keeps the list and the draft.
    branch = 'error';
    controls = <ErrorState onRetry={() => mine.refetch()} />;
  } else if (live) {
    branch = 'applied';
    // An application to this listing never waits for the profile.
    controls = (
      <div className="flex flex-col items-start gap-2">
        {apply.isSuccess && (
          <p
            role="status"
            tabIndex={-1}
            className="text-start text-body font-semibold text-accent-strong focus:outline-none"
          >
            {t('applications.sent')}
          </p>
        )}
        <Applied application={application} />
      </div>
    );
  } else if (listing.room_fit === false) {
    // The API's answer for this seeker; it needs no profile request. No link: the cause may be
    // the room's preference or the seeker's own, and the line nudges no one to change either.
    branch = 'misfit';
    controls = (
      <p tabIndex={-1} className="text-start text-body focus:outline-none">
        {t('rooms.apply.misfit')}
      </p>
    );
  } else if (profile.isPending) {
    branch = 'loading';
    controls = skeleton;
  } else if (profile.isError && profile.data === undefined) {
    branch = 'error';
    controls = <ErrorState onRetry={() => profile.refetch()} />;
  } else if (
    listing.listing_type === 'room' &&
    listing.gender_preference !== 'any' &&
    (profile.data?.gender ?? null) === null
  ) {
    // Before `ProfileGate`: its link opens both parts of the profile (0010c).
    branch = 'roomGate';
    controls = <RoomGate listing={listing} />;
  } else if (!hasLooking(profile.data)) {
    branch = 'profileGate';
    controls = <ProfileGate listingId={listing.id} />;
  } else {
    branch = 'form';
    controls = (
      <ApplyForm
        apply={apply}
        listingId={listing.id}
        userId={me.data?.id}
        onSubmitted={(value) => {
          submitted.current = value;
        }}
      />
    );
  }

  // After a submit, the first line of the branch that replaced the form takes focus: the sent
  // line (201), the misfit line, a gate's paragraph, or the applied block (409s). A branch shown
  // without a submit in this tab (on mount, after a reload or a push) takes none.
  useEffect(() => {
    if (!submitted.current || branch === 'form') return;
    submitted.current = false;
    if (FOCUSED_BRANCHES.has(branch)) controlsRef.current?.querySelector('p')?.focus();
  }, [branch]);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className="text-h3 font-semibold focus:outline-none"
      >
        {ownerView ? t('applications.headingOwner') : t('applications.heading')}
      </h2>
      <p className="text-start text-body text-ink-muted">{countLine}</p>
      <div ref={controlsRef} className="contents">
        {controls}
      </div>
    </section>
  );
}
