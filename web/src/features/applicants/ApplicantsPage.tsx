import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';

import { PageContainer } from '../../components/PageContainer';
import { usePageTitle } from '../../app/usePageTitle';
import { Button } from '../../components/Button';
import { useConfirm } from '../../components/Dialog';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { BackLink, PageHeader } from '../../components/PageHeader';
import { Skeleton } from '../../components/Skeleton';
import { TabPanel, Tabs, tabId } from '../../components/Tabs';
import { useIsDesktop } from '../../components/useMediaQuery';
import { cardTitle } from '../listings/cardTitle';
import { formatIls } from '../listings/format';
import { MY_LISTINGS_KEY, useMyListings } from '../listings/useMyListings';
import { hasStatus } from '../applications/api';
import type { ApplicantOut, ApplicantStatus } from './api';
import { ApplicantCard, type CardOutcome } from './ApplicantCard';
import { ApplicantPane } from './ApplicantPane';
import { useApplicants } from './useApplicants';

const section = 'flex flex-col gap-4';

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

/** The page's one status line: a status change, announced only (`sr-only`), or shown when the
 * changed card left the current filter (`movedOut`, spec 0009g). */
type Announcement = { text: string; movedOut: boolean };
const NO_ANNOUNCEMENT: Announcement = { text: '', movedOut: false };

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
  const queryClient = useQueryClient();
  // A 404 on the applicants: the listing is gone (deleted, or no longer this owner's). Nothing
  // cached shows not-found at once; cached cards stay, and "my listings" is refetched (once per
  // listing id), which flips the page to not-found when the listing has left it (spec 0009g).
  const applicantsGone = hasStatus(applicants.error, 404);
  const refetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!applicantsGone || refetchedFor.current === id) return;
    refetchedFor.current = id;
    void queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
  }, [applicantsGone, id, queryClient]);
  const notFound =
    listings.data !== undefined &&
    (listing === undefined || (applicantsGone && applicants.data === undefined));
  const [filter, setFilter] = useState<Filter>('all');
  // "By match" is the API's order as received; "by date" is sorted here, on a copy.
  const [sort, setSort] = useState<Sort>('match');
  const [announcement, setAnnouncement] = useState<Announcement>(NO_ANNOUNCEMENT);
  const [gone, setGone] = useState(false);
  // From 1024px the inbox is a card grid beside a detail pane (0009u); `selectedId` is kept, and
  // ignored, below that. `null` means the first card shown.
  const isDesktop = useIsDesktop();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const paneId = useId();
  // Set in the action's callback; applied by the effect after the next render.
  const pendingFocus = useRef<FocusRequest | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const baseId = useId();
  // The tabs and the one panel they control.
  const panelId = useId();
  const headingIdOf = (applicantId: string) => `${baseId}-${applicantId}`;
  const [confirm, confirmDialog] = useConfirm();
  const confirmDecline = (name: string) =>
    confirm({
      title: t('applicants.declineConfirm', { name }),
      confirmLabel: t('applicants.actions.decline'),
      tone: 'danger',
    });
  usePageTitle(
    notFound
      ? t('applicants.notFound')
      : listing !== undefined
        ? `${t('applicants.titleFor')} ${cardTitle(t, listing)}`
        : t('applicants.title'),
  );

  // Runs after the render that follows the action, when the target is in the DOM and enabled.
  // The card's `<h2>`, else the selected tab, else the `<h1>`.
  useEffect(() => {
    const focus = pendingFocus.current;
    if (focus === null) return;
    pendingFocus.current = null;
    const target =
      (focus.to === 'heading' ? document.getElementById(focus.id) : null) ??
      (focus.to === 'button' && focus.element.isConnected ? focus.element : null) ??
      document.getElementById(tabId(panelId, filter)) ??
      headingRef.current;
    target?.focus();
  }, [focusTick, filter, panelId]);

  function setFocus(request: FocusRequest) {
    pendingFocus.current = request;
    setFocusTick((n) => n + 1);
  }

  function onSettled(applicantId: string, outcome: CardOutcome, button: HTMLButtonElement | null) {
    if (outcome.kind === 'changed') {
      const updated = outcome.applicant;
      setGone(false);
      const values = {
        name: updated.applicant_name,
        status: {
          submitted: t('applicants.status.submitted'),
          shortlisted: t('applicants.status.shortlisted'),
          declined: t('applicants.status.declined'),
        }[updated.status],
      };
      // A card that left the current filter says why, visibly; otherwise the line is announced only.
      const movedOut = !matches(filter, updated);
      setAnnouncement({
        text: movedOut ? t('applicants.movedOut', values) : t('applicants.statusChanged', values),
        movedOut,
      });
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

  const back = { to: '/me/listings', label: t('listings.edit.backToMine') };

  // A cached list is used while it refetches, and kept if that refetch fails (every action
  // invalidates "my listings"). Loading and a failed list keep the page's <h1>: its text needs no
  // data.
  if (listings.data === undefined) {
    const title = (
      <h1 className="text-start font-display text-h2 lg:text-h1">{t('applicants.title')}</h1>
    );
    if (listings.isPending) {
      return (
        <PageContainer as="section" width="wide" className={section}>
          {title}
          <Loading>
            <Skeleton />
          </Loading>
        </PageContainer>
      );
    }
    return (
      <PageContainer as="section" width="wide" className={section}>
        <BackLink {...back} />
        {title}
        <ErrorState onRetry={() => listings.refetch()} />
      </PageContainer>
    );
  }

  if (listing === undefined || notFound) {
    return (
      <PageContainer as="section" width="wide" className={section}>
        <PageHeader back={back} title={t('applicants.notFound')} />
      </PageContainer>
    );
  }

  let tiles = null;
  let body;
  const list = applicants.data;
  if (list === undefined) {
    body = applicants.isError ? (
      <ErrorState onRetry={() => applicants.refetch()} />
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
    body = <EmptyState pose="sleep" message={t('applicants.empty')} />;
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
        tone: isDesktop ? 'border border-border bg-surface' : 'bg-surface-subtle',
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
        tone: isDesktop ? 'border border-border bg-surface' : 'bg-surface-subtle',
      },
    ];
    const filtered = list.filter((a) => matches(filter, a));
    const shown = sort === 'newest' ? filtered.toSorted(newestFirst) : filtered;
    // The selected applicant (desktop): the chosen one while it is in view, else the first shown.
    const selected = shown.find((a) => a.id === selectedId) ?? shown[0];
    const sortLabel: Record<Sort, string> = {
      match: t('applicants.sort.match'),
      newest: t('applicants.sort.newest'),
    };
    tiles = (
      <ul data-testid="applicant-totals" className="flex gap-2">
        {stats.map((stat) => (
          <li
            key={stat.key}
            className={`flex min-w-24 flex-1 flex-col gap-0.5 rounded-lg px-3 py-3 lg:min-w-32 ${stat.tone}`}
          >
            <span className="font-display text-h2">{stat.value}</span>{' '}
            <span className="text-caption">{stat.label}</span>
          </li>
        ))}
      </ul>
    );
    const tabs = (
      <Tabs
        label={t('applicants.filter.label')}
        items={FILTERS.map((f) => ({ value: f, label: filterLabel[f] }))}
        value={filter}
        onChange={(f) => {
          setGone(false);
          setAnnouncement(NO_ANNOUNCEMENT);
          setFilter(f);
          // A new tab opens on its first card.
          setSelectedId(null);
        }}
        variant="underline"
        scrollable
        panelId={panelId}
        // On desktop the row below owns the bottom line.
        className={isDesktop ? 'border-b-0' : undefined}
      />
    );
    const sortGroup = (
      <div
        role="group"
        aria-label={t('applicants.sort.label')}
        className="flex flex-wrap items-center gap-2"
      >
        {SORTS.map((s) => (
          <Button
            key={s}
            size="sm"
            shape="pill"
            variant={sort === s ? 'soft' : 'ghost'}
            aria-pressed={sort === s}
            onClick={() => setSort(s)}
          >
            {sortLabel[s]}
          </Button>
        ))}
      </div>
    );
    const cardOf = (applicant: ApplicantOut) => (
      <li key={applicant.id}>
        <ApplicantCard
          layout={isDesktop ? 'compact' : 'stacked'}
          selected={applicant.id === selected?.id}
          onSelect={() => setSelectedId(applicant.id)}
          paneId={paneId}
          listingId={listing.id}
          applicant={applicant}
          headingId={headingIdOf(applicant.id)}
          spots={listing.parking_spots}
          flatLifestyle={listing.lifestyle}
          flatIsRoom={listing.listing_type === 'room'}
          confirmDecline={confirmDecline}
          onSettled={(outcome, button) => onSettled(applicant.id, outcome, button)}
        />
      </li>
    );
    body = (
      <>
        {isDesktop ? (
          <div className="flex items-end justify-between gap-3 border-b border-border">
            {tabs}
            {sortGroup}
          </div>
        ) : (
          <>
            {tabs}
            {sortGroup}
          </>
        )}
        <TabPanel panelId={panelId} value={filter}>
          {selected === undefined ? (
            <EmptyState message={t('applicants.emptyFilter')} />
          ) : isDesktop ? (
            <div className="flex items-start gap-6">
              <ul className="grid min-w-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-2">
                {shown.map(cardOf)}
              </ul>
              <ApplicantPane
                key={selected.id}
                id={paneId}
                applicant={selected}
                spots={listing.parking_spots}
                flatLifestyle={listing.lifestyle}
                flatIsRoom={listing.listing_type === 'room'}
              />
            </div>
          ) : (
            <ul className="flex max-w-page flex-col gap-3">{shown.map(cardOf)}</ul>
          )}
        </TabPanel>
      </>
    );
  }

  return (
    <PageContainer as="section" width="wide" className={section}>
      <PageHeader
        back={back}
        eyebrow={t('applicants.titleFor')}
        title={cardTitle(t, listing)}
        subtitle={`${formatIls(listing.price_ils)} ${t('listings.units.ils')}`}
        titleRef={headingRef}
        actions={isDesktop ? tiles : undefined}
      />
      {!isDesktop && tiles}
      {gone && (
        <p role="alert" className="text-body-sm font-semibold text-danger">
          {t('applicants.errors.gone')}
        </p>
      )}
      {/* Always mounted in this one place (never remounted), so a change is announced once. */}
      <p
        role="status"
        className={announcement.movedOut ? 'text-body-sm text-ink-muted' : 'sr-only'}
      >
        {announcement.text}
      </p>
      {body}
      {confirmDialog}
    </PageContainer>
  );
}
