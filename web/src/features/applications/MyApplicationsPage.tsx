import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { usePageTitle } from '../../app/usePageTitle';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { Skeleton } from '../../components/Skeleton';
import { formatIls, formatRooms } from '../listings/format';
import { hasStatus, type MyApplicationOut } from './api';
import { ApplicationStatusChip } from './ApplicationStatusChip';
import { appliedOn, isWithdrawable } from './format';
import { useMyApplications } from './useMyApplications';
import { useWithdraw } from './useWithdraw';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const fieldError = 'text-sm font-semibold text-[#B91C1C]';
const action = `inline-flex min-h-[44px] items-center rounded-full border-[1.5px] border-[#D6D3D1] bg-white px-4 text-[15px] font-semibold disabled:opacity-60 ${focusRing}`;

function ApplicationCard({ application }: { application: MyApplicationOut }) {
  const { t } = useTranslation();
  const withdraw = useWithdraw(application.id);
  const titleId = useId();
  const { listing } = application;
  // Same-tick guard: a double click sends one request (a second would answer 409).
  const inFlight = useRef(false);

  function onWithdraw() {
    if (inFlight.current) return;
    inFlight.current = true;
    withdraw.mutate(undefined, {
      onSettled: () => {
        inFlight.current = false;
      },
    });
  }

  return (
    <li>
      <article className="flex flex-col gap-2 rounded-2xl border border-line bg-white px-4 pb-4 pt-[14px]">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[20px] font-extrabold tracking-[-0.3px]">
            <span>
              {formatIls(listing.price_ils)} {t('listings.units.ils')}
            </span>{' '}
            <span className="text-sm font-medium tracking-normal text-muted">
              {t('listings.units.perMonth')}
            </span>
          </p>
          <ApplicationStatusChip status={application.status} />
        </div>
        <h2 id={titleId} className="break-words text-lg font-bold leading-snug">
          <Link
            to={`/listings/${listing.id}`}
            className={`inline-flex min-h-[44px] items-center rounded text-accent-text underline underline-offset-4 ${focusRing}`}
          >
            {t('listings.card.title', {
              rooms: formatRooms(listing.rooms),
              street: listing.street,
              city: listing.city,
            })}
          </Link>
        </h2>
        <p className="text-start text-sm text-muted">
          {t('applications.applied', { date: appliedOn(application.created_at) })}
        </p>
        {application.status === 'declined' && (
          <p className="text-start text-sm text-muted">{t('applications.declinedHint')}</p>
        )}
        {application.source === 'like' ? (
          <p
            data-testid="application-mutual"
            className="self-start rounded-full border border-accent-tint bg-accent-tint px-3 py-[6px] text-[13px] font-semibold text-accent-text"
          >
            {t('applications.mutual')}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold text-muted">{t('applications.yourMessage')}</p>
            {/* Plain text from the seeker: React children only, line breaks kept. */}
            <p
              data-testid="application-message"
              className="whitespace-pre-line break-words text-[15px] leading-relaxed"
            >
              {application.message}
            </p>
          </div>
        )}
        {(isWithdrawable(application.status) || withdraw.isError) && (
          <div className="flex flex-col items-start gap-2 pt-1">
            {application.status === 'shortlisted' && (
              // The chat opens on shortlist (0005a); its id is the application's.
              <Link
                to={`/chat/${application.id}`}
                aria-describedby={titleId}
                className={`inline-flex min-h-[44px] items-center rounded-full border-[1.5px] border-accent bg-accent-tint px-4 text-[15px] font-bold text-accent-text ${focusRing}`}
              >
                {t('applications.chat')}
              </Link>
            )}
            {isWithdrawable(application.status) && (
              <button
                type="button"
                onClick={onWithdraw}
                disabled={withdraw.isPending}
                aria-busy={withdraw.isPending}
                aria-describedby={titleId}
                className={action}
              >
                {t('applications.withdraw')}
              </button>
            )}
            {/* A 401 clears the session and RequireSeeker leaves the page. */}
            {withdraw.isError && !hasStatus(withdraw.error, 401) && (
              <p role="alert" className={fieldError}>
                {t('common.error')}
              </p>
            )}
          </div>
        )}
      </article>
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
        <div className="flex flex-col gap-3">
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
      <div className="flex flex-col gap-3">
        <EmptyState message={t('applications.mine.empty')} />
        <Link
          to="/search"
          className={`inline-flex min-h-[44px] items-center self-start rounded-full bg-accent px-4 text-[15px] font-semibold text-white ${focusRing}`}
        >
          {t('applications.mine.search')}
        </Link>
      </div>
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
    <section className="mx-auto flex w-full max-w-[480px] flex-col gap-4">
      <h1 className="text-start text-2xl font-extrabold">{t('applications.mine.title')}</h1>
      {body}
    </section>
  );
}
