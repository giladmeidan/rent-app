import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

import { ErrorState } from '../../components/ErrorState';
import { Skeleton } from '../../components/Skeleton';
import { BackToMine, ListingWizard } from './ListingWizard';
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

  // A cached list is used while it refetches, and kept if that refetch fails: the owner may be
  // typing in the form.
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

  const listing = listings.data.find((l) => l.id === id);
  if (listing === undefined) {
    return (
      <section className={`${section} gap-4`}>
        <BackToMine />
        <h1 className="text-start text-2xl font-extrabold">{t('listings.edit.notFound')}</h1>
      </section>
    );
  }

  return (
    <section className={section}>
      <ListingWizard key={listing.id} listing={listing} />
    </section>
  );
}
