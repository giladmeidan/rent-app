import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { usePageTitle } from '../../app/usePageTitle';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { cx } from '../../components/cx';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { focusMainIfLost } from '../../components/focus';
import { focusRing } from '../../components/focusRing';
import { Loading } from '../../components/Loading';
import { PageContainer } from '../../components/PageContainer';
import { PageHeader } from '../../components/PageHeader';
import { Skeleton } from '../../components/Skeleton';
import { Tag } from '../../components/Tag';
import { useOnline } from '../../components/useOnline';
import { DisclosureButton } from '../applicants/DisclosureButton';
import { ApiError, type ListingType } from '../listings/api';
import { cardTitle } from '../listings/cardTitle';
import { formatIls } from '../listings/format';
import { hasStatus, type MyApplicationOut } from './api';
import { ApplicationStatusChip } from './ApplicationStatusChip';
import { appliedOn, isWithdrawable } from './format';
import { useMyApplications } from './useMyApplications';
import { useWithdraw } from './useWithdraw';

function ApplicationCard({ application }: { application: MyApplicationOut }) {
  const { t } = useTranslation();
  const online = useOnline();
  const withdraw = useWithdraw(application.id);
  const titleId = useId();
  const { listing } = application;
  // Same-tick guard: a double click sends one request (a second would answer 409).
  const inFlight = useRef(false);
  // Where focus goes once the withdraw button is gone (spec 0009t): the title link after a 200,
  // the card's alert after a 409 whose refetch hides the button, `#main` after a 404 drops the card.
  // Once per withdraw (`submittedAt`).
  const titleRef = useRef<HTMLAnchorElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const handledAt = useRef(0);
  const gone = useRef(false);
  const withdrawable = isWithdrawable(application.status);
  const { isSuccess, isError, error, submittedAt } = withdraw;
  const conflict = isError && hasStatus(error, 409);

  useEffect(() => {
    if (withdrawable || submittedAt === handledAt.current) return;
    if (isSuccess) titleRef.current?.focus();
    else if (conflict) alertRef.current?.focus();
    else return;
    handledAt.current = submittedAt;
  }, [withdrawable, isSuccess, conflict, submittedAt]);

  useLayoutEffect(
    () => () => {
      if (gone.current) focusMainIfLost();
    },
    [],
  );

  function onWithdraw() {
    if (inFlight.current) return;
    inFlight.current = true;
    withdraw.mutate(undefined, {
      onSettled: () => {
        inFlight.current = false;
      },
      onError: (failure) => {
        if (hasStatus(failure, 404)) gone.current = true;
      },
    });
  }

  const showActions = withdrawable || application.status === 'shortlisted';

  return (
    <li>
      {/* Every card is the default one (ux review: a muted card hid the neutral chip and put the
          accent title off `surface`); the chip and the declined hint carry the ended state. */}
      <Card as="article" padding="md" className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-h3 font-semibold">
            <span>
              {formatIls(listing.price_ils)} {t('listings.units.ils')}
            </span>{' '}
            <span className="text-caption font-medium text-ink-muted">
              {t('listings.units.perMonth')}
            </span>
          </p>
          <ApplicationStatusChip status={application.status} />
        </div>
        <h2 id={titleId} className="text-h3 leading-snug [overflow-wrap:anywhere]">
          <Link
            ref={titleRef}
            to={`/listings/${listing.id}`}
            className={cx(
              'inline-flex min-h-tap items-center rounded text-accent underline underline-offset-4',
              focusRing,
            )}
          >
            {cardTitle(t, listing)}
          </Link>
        </h2>
        <div className="flex flex-col gap-1">
          <p className="text-start text-caption text-ink-muted">
            {t('applications.applied', { date: appliedOn(application.created_at) })}
          </p>
          {application.status === 'declined' && (
            <p className="text-start text-caption text-ink-muted">
              {t('applications.declinedHint')}
            </p>
          )}
        </div>
        {/* The tag and the message are independent (spec 0010l): an invite answered may carry a
            message, and a room application may have none. */}
        {application.source === 'like' && (
          <Tag tone="accent" data-testid="application-mutual" className="self-start">
            {t('applications.mutual')}
          </Tag>
        )}
        {application.message !== null && (
          <div className="flex flex-col gap-1">
            <p className="text-label text-ink-muted">{t('applications.yourMessage')}</p>
            {/* Plain text from the seeker: React children only, line breaks kept. */}
            <p
              data-testid="application-message"
              className="whitespace-pre-line break-words rounded-md bg-surface-subtle px-3.5 py-3 text-body leading-relaxed text-ink"
            >
              {application.message}
            </p>
          </div>
        )}
        {(showActions || withdraw.isError) && (
          <div className="flex flex-col gap-2 pt-1">
            {showActions && (
              <div className="flex flex-wrap gap-2">
                {application.status === 'shortlisted' && (
                  // The chat opens on shortlist (0005a); its id is the application's.
                  <Button
                    variant="primary"
                    to={`/chat/${application.id}`}
                    aria-describedby={titleId}
                    className="flex-1 lg:flex-none"
                  >
                    {t('applications.chat')}
                  </Button>
                )}
                {withdrawable && (
                  <Button
                    variant="secondary"
                    onClick={onWithdraw}
                    disabled={withdraw.isPending}
                    aria-busy={withdraw.isPending}
                    aria-describedby={titleId}
                    className="flex-1 lg:flex-none"
                  >
                    {t('applications.withdraw')}
                  </Button>
                )}
              </div>
            )}
            {/* A 401 clears the session and the route guard (`RequireSeeker`, `RequireUser` on the market panel) leaves the page. */}
            {withdraw.isError && !hasStatus(withdraw.error, 401) && (
              <p
                ref={alertRef}
                tabIndex={-1}
                role="alert"
                className="text-body-sm font-semibold text-danger focus:outline-none"
              >
                {withdraw.error instanceof ApiError &&
                withdraw.error.status === 409 &&
                withdraw.error.detail === 'not_withdrawable'
                  ? t('applications.errors.notWithdrawable')
                  : online
                    ? t('common.error')
                    : t('common.offline')}
              </p>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

type Props = {
  /** The side's type (spec 0010a): `/me/applications` shows apartment applications, the market's
   * "שלי" room applications. */
  type?: ListingType;
  /** A tab panel inside a page that owns the `<h1>`, the container and the tab's title
   * (`MarketMinePage`); the tab labels it, so it has no heading of its own. */
  panel?: boolean;
};

/** `/me/applications`, seekers only (`RequireSeeker`), and "שלי"'s room applications for any
 * account (spec 0010b): each application of one type with its status. */
export function MyApplicationsPage({ type = 'apartment', panel = false }: Props) {
  if (panel) {
    return (
      <div className="flex flex-col gap-4">
        <MyApplications type={type} panel />
      </div>
    );
  }
  return <MyApplicationsRoute type={type} />;
}

/** The page on its own route: its container and the tab's title. */
function MyApplicationsRoute({ type }: { type: ListingType }) {
  const { t } = useTranslation();
  usePageTitle(t('applications.mine.title'));
  return (
    <PageContainer as="section" width="default" className="flex flex-col gap-4">
      <MyApplications type={type} panel={false} />
    </PageContainer>
  );
}

function MyApplications({ type, panel }: { type: ListingType; panel: boolean }) {
  const { t } = useTranslation();
  const applications = useMyApplications();
  const room = type === 'room';
  // Ids seen active on this visit. They stay in the active list after a withdraw or a refetch: moving
  // a card into "past" would remount it and drop its focus target and its 409 alert (spec 0009t).
  const [seenActive] = useState(() => new Set<string>());
  const [pastOpen, setPastOpen] = useState(false);
  const pastId = useId();

  const shown = (applications.data ?? []).filter((a) => a.listing.listing_type === type);
  for (const a of shown) if (isWithdrawable(a.status)) seenActive.add(a.id);
  const active = shown.filter((a) => seenActive.has(a.id));
  const past = shown.filter((a) => !seenActive.has(a.id));

  let body;
  if (applications.isPending) {
    body = (
      <Loading>
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} />
          ))}
        </div>
      </Loading>
    );
  } else if (applications.isError && applications.data === undefined) {
    // Only when nothing is cached: a failed background refetch keeps the list on the page.
    body = <ErrorState onRetry={() => applications.refetch()} />;
  } else if (shown.length === 0) {
    body = (
      <EmptyState
        pose="sleep"
        message={room ? t('market.mine.applicationsEmpty') : t('applications.mine.empty')}
        action={
          <Button variant="primary" to={room ? '/market' : '/search'}>
            {room ? t('market.toSearch') : t('applications.mine.search')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <>
        {active.length > 0 ? (
          <ul className="flex flex-col gap-4">
            {active.map((application) => (
              <ApplicationCard key={application.id} application={application} />
            ))}
          </ul>
        ) : (
          <p className="text-body text-ink-muted">{t('applications.mine.noActive')}</p>
        )}
        {past.length > 0 && (
          // Declined and withdrawn ones, closed by default. Always in the DOM, so `aria-controls`
          // names the list; a display class would override `hidden`, so it is set only when open.
          <div className="flex flex-col gap-4">
            <div>
              <DisclosureButton
                open={pastOpen}
                controls={pastId}
                onToggle={() => setPastOpen((o) => !o)}
              >
                {t('applications.mine.past', { count: past.length })}
              </DisclosureButton>
            </div>
            <ul
              id={pastId}
              hidden={!pastOpen}
              data-testid="past-applications"
              className={pastOpen ? 'flex flex-col gap-4' : undefined}
            >
              {past.map((application) => (
                <ApplicationCard key={application.id} application={application} />
              ))}
            </ul>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {/* In "שלי"'s tab panel the tab names it (spec 0010b): no heading of its own. */}
      {!panel && (
        <PageHeader
          title={room ? t('market.mine.tabs.applications') : t('applications.mine.title')}
        />
      )}
      {body}
    </>
  );
}
