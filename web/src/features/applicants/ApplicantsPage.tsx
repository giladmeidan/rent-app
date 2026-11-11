import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { formatIls, formatRooms } from '../listings/format';
import { BackToMine } from '../listings/ListingWizard';
import { useMyListings } from '../listings/useMyListings';
import type { ApplicantOut, ApplicantStatus } from './api';
import { ApplicantCard, type CardOutcome } from './ApplicantCard';
import { useApplicants } from './useApplicants';

const section = 'mx-auto flex w-full max-w-[640px] flex-col gap-4';
const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

type Filter = 'all' | ApplicantStatus;
const FILTERS: readonly Filter[] = ['all', 'submitted', 'shortlisted', 'declined'];

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
  const [announcement, setAnnouncement] = useState('');
  const [gone, setGone] = useState(false);
  // Set in the action's callback; applied by the effect after the next render.
  const pendingFocus = useRef<FocusRequest | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const filterRefs = useRef(new Map<Filter, HTMLButtonElement>());
  const baseId = useId();
  const headingIdOf = (applicantId: string) => `${baseId}-${applicantId}`;

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
  // invalidates "my listings").
  if (listings.data === undefined) {
    if (listings.isPending) {
      return (
        <section className={section}>
          <div aria-busy="true" aria-label={t('common.loading')}>
            <Skeleton />
          </div>
        </section>
      );
    }
    return (
      <section className={section}>
        <ErrorState onRetry={() => void listings.refetch()} />
      </section>
    );
  }

  if (listing === undefined) {
    return (
      <section className={section}>
        <BackToMine />
        <h1 className="text-start text-2xl font-extrabold">{t('applicants.notFound')}</h1>
      </section>
    );
  }

  let body;
  const list = applicants.data;
  if (list === undefined) {
    body = applicants.isError ? (
      <ErrorState onRetry={() => void applicants.refetch()} />
    ) : (
      <ul aria-busy="true" aria-label={t('common.loading')} className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <Skeleton />
          </li>
        ))}
      </ul>
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
      { key: 'total', value: counts.all, label: t('applicants.stats.total'), tone: 'bg-[#F5F5F4]' },
      {
        key: 'shortlisted',
        value: counts.shortlisted,
        label: t('applicants.stats.shortlisted'),
        tone: 'bg-accent-tint text-accent-text',
      },
      {
        key: 'new',
        value: counts.submitted,
        label: t('applicants.stats.new'),
        tone: 'bg-[#F5F5F4]',
      },
    ];
    const shown = list.filter((a) => matches(filter, a));
    body = (
      <>
        <ul data-testid="applicant-totals" className="flex flex-wrap gap-[10px]">
          {stats.map((stat) => (
            <li
              key={stat.key}
              className={`flex min-w-[96px] flex-1 flex-col gap-[2px] rounded-[14px] px-[14px] py-3 ${stat.tone}`}
            >
              <span className="text-2xl font-extrabold">{stat.value}</span>
              <span className="text-[13px]">{stat.label}</span>
            </li>
          ))}
        </ul>
        <div
          role="group"
          aria-label={t('applicants.filter.label')}
          className="flex flex-wrap gap-1 border-b border-line"
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
              onClick={() => setFilter(f)}
              className={`min-h-[44px] border-b-[2.5px] px-[14px] text-sm ${
                filter === f
                  ? 'border-accent font-bold text-accent-text'
                  : 'border-transparent font-semibold text-muted'
              } ${focusRing}`}
            >
              {filterLabel[f]}
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
                onSettled={(outcome, button) => onSettled(applicant.id, outcome, button)}
              />
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <section className={section}>
      <BackToMine />
      <div className="flex flex-col gap-1">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-start text-2xl font-extrabold focus:outline-none"
        >
          {t('applicants.title')}
        </h1>
        <p className="text-start font-bold">
          {t('listings.card.title', {
            rooms: formatRooms(listing.rooms),
            street: listing.street,
            city: listing.city,
          })}
        </p>
        <p className="text-start text-sm text-muted">
          {formatIls(listing.price_ils)} {t('listings.units.ils')}
        </p>
      </div>
      {gone && (
        <p role="alert" className="text-sm font-semibold text-[#B91C1C]">
          {t('applicants.errors.gone')}
        </p>
      )}
      {body}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  );
}
