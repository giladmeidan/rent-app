import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { usePageTitle } from '../../app/usePageTitle';
import { ErrorState } from '../../components/ErrorState';
import { Loading } from '../../components/Loading';
import { Skeleton } from '../../components/Skeleton';
import { BackToMine, ListingWizard } from './ListingWizard';
import { isPastExpiry } from './StatusBadge';
import { useMyListings } from './useMyListings';

const section = 'mx-auto flex w-full max-w-[480px] flex-col';

/**
 * `/me/listings/:id/edit`: the wizard in edit mode for one of the owner's listings, found in
 * `GET /me/listings` (which has every own listing; the public `GET /listings/{id}` hides paused
 * and expired ones). An id that is not in the list — another owner's, unknown or malformed — is
 * "not found", and nothing tells those apart.
 */
export function EditListingPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const listings = useMyListings();
  const expiredHeading = useRef<HTMLHeadingElement>(null);
  const now = new Date();
  const listing = listings.data?.find((l) => l.id === id);
  const readOnly = listing !== undefined && isPastExpiry(listing, now);
  // Focus the explanation on arrival (the hook runs before any early return).
  useEffect(() => {
    if (readOnly) expiredHeading.current?.focus();
  }, [readOnly]);
  // The tab is named after the state's <h1> (the wizard's is the edit title as well).
  usePageTitle(
    t(
      listings.data !== undefined && listing === undefined
        ? 'listings.edit.notFound'
        : readOnly
          ? 'listings.edit.expiredTitle'
          : 'listings.edit.title',
    ),
  );
  // Loading and a failed list keep the page's <h1>: its text needs no data.
  const title = <h1 className="text-start text-2xl font-extrabold">{t('listings.edit.title')}</h1>;

  // A cached list is used while it refetches, and kept if that refetch fails: the owner may be
  // typing in the form.
  if (listings.data === undefined) {
    if (listings.isPending) {
      return (
        <section className={`${section} gap-4`}>
          {title}
          <Loading>
            <Skeleton />
          </Loading>
        </section>
      );
    }
    return (
      <section className={`${section} gap-4`}>
        {title}
        <ErrorState onRetry={() => void listings.refetch()} />
      </section>
    );
  }

  if (listing === undefined) {
    return (
      <section className={`${section} gap-4`}>
        <BackToMine />
        <h1 className="text-start text-2xl font-extrabold">{t('listings.edit.notFound')}</h1>
      </section>
    );
  }

  if (readOnly) {
    return (
      <section className={`${section} gap-4`}>
        <BackToMine />
        <h1
          ref={expiredHeading}
          tabIndex={-1}
          className="text-start text-2xl font-extrabold focus:outline-none"
        >
          {t('listings.edit.expiredTitle')}
        </h1>
        <p className="text-start text-[15px] text-muted">{t('listings.edit.expiredBody')}</p>
      </section>
    );
  }

  return (
    <section className={section}>
      <ListingWizard key={listing.id} listing={listing} />
    </section>
  );
}
