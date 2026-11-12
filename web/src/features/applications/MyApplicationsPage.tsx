import { useEffect, useId, useLayoutEffect, useRef } from 'react';
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
import { ApiError } from '../listings/api';
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

  const ended = application.status === 'declined' || application.status === 'withdrawn';
  const showActions = withdrawable || application.status === 'shortlisted';

  return (
    <li>
      <Card
        as="article"
        padding="md"
        variant={ended ? 'muted' : 'default'}
        className="flex flex-col gap-3"
      >
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
        {application.source === 'like' ? (
          <Tag tone="accent" data-testid="application-mutual" className="self-start">
            {t('applications.mutual')}
          </Tag>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-label text-ink-muted">{t('applications.yourMessage')}</p>
            {/* Plain text from the seeker: React children only, line breaks kept. */}
            <p
              data-testid="application-message"
              className={cx(
                'whitespace-pre-line break-words rounded-md px-3.5 py-3 text-body leading-relaxed text-ink',
                ended ? 'bg-surface' : 'bg-surface-subtle',
              )}
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
            {/* A 401 clears the session and RequireSeeker leaves the page. */}
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

/** `/me/applications`, seekers only (`RequireSeeker`): each application with its status. */
export function MyApplicationsPage() {
  const { t } = useTranslation();
  usePageTitle(t('applications.mine.title'));
  const applications = useMyApplications();

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
    body = <ErrorState onRetry={() => void applications.refetch()} />;
  } else if (applications.data.length === 0) {
    body = (
      <EmptyState
        pose="sleep"
        message={t('applications.mine.empty')}
        action={
          <Button variant="primary" to="/search">
            {t('applications.mine.search')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <ul className="flex flex-col gap-4">
        {applications.data.map((application) => (
          <ApplicationCard key={application.id} application={application} />
        ))}
      </ul>
    );
  }

  return (
    <PageContainer as="section" width="default" className="flex flex-col gap-4">
      <PageHeader title={t('applications.mine.title')} />
      {body}
    </PageContainer>
  );
}
