import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { PageContainer } from '../../components/PageContainer';
import { usePageTitle } from '../../app/usePageTitle';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { Skeleton } from '../../components/Skeleton';
import { cardTitle } from '../listings/cardTitle';
import { formatIls } from '../listings/format';
import { BackToMine } from '../listings/ListingWizard';
import { useMyListings } from '../listings/useMyListings';
import type { ApplicantOut, ApplicantStatus } from './api';
import { ApplicantCard, type CardOutcome } from './ApplicantCard';
import { useApplicants } from './useApplicants';

const section = 'flex flex-col gap-4';
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

type Filter = 'all' | ApplicantStatus;
const FILTERS: readonly Filter[] = ['all', 'submitted', 'shortlisted', 'declined'];

type Sort = 'match' | 'newest';
const SORTS: readonly Sort[] = ['match', 'newest'];

/** Newest first, as `0006c`'s `created_at DESC, id`. Times compare as instants, never as strings
 * (Pydantic drops zero microseconds, so `…:00Z` would sort after `…:00.5Z`). */
const newestFirst = (a: ApplicantOut, b: ApplicantOut) =>
  Date.parse(b.created_at) - Date.parse(a.created_at) || (a.id < b.id ? -1 : 1);

/** Where focus goes once the page has re-rendered after an action (never lost: 0004d a11y). */
type FocusRequest =
  { to: 'heading'; id: string } | { to: 'filter' } | { to: 'button'; element: HTMLButtonElement };

const matches = (filter: Filter, applicant: ApplicantOut) =>
  filter === 'all' || applicant.status === filter;

/**
 * `/me/listings/:id/applicants`, owners only (`RequireOwner`): the applicants of one own listing,
 * found in `GET /me/listings` (an id not in it — another owner's, unknown, malformed — is "not
 * found" and its applicants are never requested). Totals and filters are counted from the loaded
 * list, so they always agree with the cards.
 */
export function ApplicantsPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const listings = useMyListings();
  const listing = listings.data?.find((l) => l.id === id);
  const applicants = useApplicants(id, listing !== undefined);
  const [filter, setFilter] = useState<Filter>('all');
  // "By match" is the API's order as received; "by date" is sorted here, on a copy.
  const [sort, setSort] = useState<Sort>('match');
  const [announcement, setAnnouncement] = useState('');
  const [gone, setGone] = useState(false);
  // Set in the action's callback; applied by the effect after the next render.
  const pendingFocus = useRef<FocusRequest | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const filterRefs = useRef(new Map<Filter, HTMLButtonElement>());
  const baseId = useId();
  const headingIdOf = (applicantId: string) => `${baseId}-${applicantId}`;
  usePageTitle(
    t(
      listings.data !== undefined && listing === undefined
        ? 'applicants.notFound'
        : 'applicants.title',
    ),
  );

  // Runs after the render that follows the action, when the target is in the DOM and enabled.
  // The card's `<h2>`, else the pressed filter button, else the `<h1>`.
  useEffect(() => {
    const focus = pendingFocus.current;
    if (focus === null) return;
    pendingFocus.current = null;
    const target =
      (focus.to === 'heading' ? document.getElementById(focus.id) : null) ??
      (focus.to === 'button' && focus.element.isConnected ? focus.element : null) ??
      filterRefs.current.get(filter) ??
      headingRef.current;
    target?.focus();
  }, [focusTick, filter]);

  function setFocus(request: FocusRequest) {
    pendingFocus.current = request;
    setFocusTick((n) => n + 1);
  }

  function onSettled(applicantId: string, outcome: CardOutcome, button: HTMLButtonElement | null) {
    if (outcome.kind === 'changed') {
      const updated = outcome.applicant;
      setGone(false);
      setAnnouncement(
        t('applicants.statusChanged', {
          name: updated.applicant_name,
          status: {
            submitted: t('applicants.status.submitted'),
            shortlisted: t('applicants.status.shortlisted'),
            declined: t('applicants.status.declined'),
          }[updated.status],
        }),
      );
      setFocus(
        matches(filter, updated)
          ? { to: 'heading', id: headingIdOf(applicantId) }
          : { to: 'filter' },
      );
    } else if (outcome.kind === 'gone') {
      setGone(true);
      setFocus({ to: 'filter' });
    } else if (outcome.kind === 'conflict') {
      setFocus({ to: 'heading', id: headingIdOf(applicantId) });
    } else if (button !== null) {
      setFocus({ to: 'button', element: button });
    }
  }

  // A cached list is used while it refetches, and kept if that refetch fails (every action
  // invalidates "my listings"). Loading and a failed list keep the page's <h1>: its text needs no
  // data.
  if (listings.data === undefined) {
    const title = <h1 className="text-start text-2xl font-extrabold">{t('applicants.title')}</h1>;
    if (listings.isPending) {
      return (
        <PageContainer as="section" className={section}>
          {title}
          <Loading>
            <Skeleton />
          </Loading>
        </PageContainer>
      );
    }
    return (
      <PageContainer as="section" className={section}>
        <BackToMine />
        {title}
        <ErrorState onRetry={() => void listings.refetch()} />
      </PageContainer>
    );
  }

  if (listing === undefined) {
    return (
      <PageContainer as="section" className={section}>
        <BackToMine />
        <h1 className="text-start text-2xl font-extrabold">{t('applicants.notFound')}</h1>
      </PageContainer>
    );
  }

  let body;
  const list = applicants.data;
  if (list === undefined) {
    body = applicants.isError ? (
      <ErrorState onRetry={() => void applicants.refetch()} />
    ) : (
      <Loading>
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} />
          ))}
        </div>
      </Loading>
    );
  } else if (list.length === 0) {
    body = <EmptyState message={t('applicants.empty')} />;
  } else {
    const count = (status: ApplicantStatus) => list.filter((a) => a.status === status).length;
    const counts: Record<Filter, number> = {
      all: list.length,
      submitted: count('submitted'),
      shortlisted: count('shortlisted'),
      declined: count('declined'),
    };
    const filterLabel: Record<Filter, string> = {
      all: t('applicants.filter.all', { count: counts.all }),
      submitted: t('applicants.filter.new', { count: counts.submitted }),
      shortlisted: t('applicants.filter.shortlisted', { count: counts.shortlisted }),
      declined: t('applicants.filter.declined', { count: counts.declined }),
    };
    const stats = [
      {
        key: 'total',
        value: counts.all,
        label: t('applicants.stats.total'),
        tone: 'bg-surface-subtle',
      },
      {
        key: 'shortlisted',
        value: counts.shortlisted,
        label: t('applicants.stats.shortlisted'),
        tone: 'bg-accent-soft text-accent-strong',
      },
      {
        key: 'new',
        value: counts.submitted,
        label: t('applicants.stats.new'),
        tone: 'bg-surface-subtle',
      },
    ];
    const filtered = list.filter((a) => matches(filter, a));
    const shown = sort === 'newest' ? filtered.toSorted(newestFirst) : filtered;
    const sortLabel: Record<Sort, string> = {
      match: t('applicants.sort.match'),
      newest: t('applicants.sort.newest'),
    };
    body = (
      <>
        <ul data-testid="applicant-totals" className="flex flex-wrap gap-[10px]">
          {stats.map((stat) => (
            <li
              key={stat.key}
              className={`flex min-w-[96px] flex-1 flex-col gap-[2px] rounded-[14px] px-[14px] py-3 ${stat.tone}`}
            >
              <span className="text-2xl font-extrabold">{stat.value}</span>{' '}
              <span className="text-[13px]">{stat.label}</span>
            </li>
          ))}
        </ul>
        <div
          role="group"
          aria-label={t('applicants.filter.label')}
          className="flex flex-wrap gap-1 border-b border-border"
        >
          {FILTERS.map((f) => (
            <button
              key={f}
              ref={(element) => {
                if (element) filterRefs.current.set(f, element);
                else filterRefs.current.delete(f);
              }}
              type="button"
              aria-pressed={filter === f}
              onClick={() => {
                setGone(false);
                setFilter(f);
              }}
              className={`min-h-[44px] border-b-[2.5px] px-[14px] text-sm ${
                filter === f
                  ? 'border-accent font-bold text-accent-strong'
                  : 'border-transparent font-semibold text-ink-muted'
              } ${focusRing}`}
            >
              {filterLabel[f]}
            </button>
          ))}
        </div>
        <div
          role="group"
          aria-label={t('applicants.sort.label')}
          className="flex flex-wrap items-center gap-2"
        >
          {SORTS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sort === s}
              onClick={() => setSort(s)}
              className={`min-h-[44px] rounded-full border-[1.5px] px-[14px] text-[13px] ${
                sort === s
                  ? 'border-accent bg-accent-soft font-bold text-accent-strong'
                  : 'border-border-strong bg-surface font-semibold text-ink-muted'
              } ${focusRing}`}
            >
              {sortLabel[s]}
            </button>
          ))}
        </div>
        {shown.length === 0 ? (
          <EmptyState message={t('applicants.emptyFilter')} />
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map((applicant) => (
              <ApplicantCard
                key={applicant.id}
                listingId={listing.id}
                applicant={applicant}
                headingId={headingIdOf(applicant.id)}
                spots={listing.parking_spots}
                flatLifestyle={listing.lifestyle}
                flatIsRoom={listing.listing_type === 'room'}
                onSettled={(outcome, button) => onSettled(applicant.id, outcome, button)}
              />
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <PageContainer as="section" className={section}>
      <BackToMine />
      <div className="flex flex-col gap-1">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-start text-2xl font-extrabold focus:outline-none"
        >
          {t('applicants.title')}
        </h1>
        <p className="text-start font-bold">{cardTitle(t, listing)}</p>
        <p className="text-start text-sm text-ink-muted">
          {formatIls(listing.price_ils)} {t('listings.units.ils')}
        </p>
      </div>
      {gone && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {t('applicants.errors.gone')}
        </p>
      )}
      {body}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </PageContainer>
  );
}
