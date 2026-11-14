import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';

import { ApiError, renewListing, type MyListingOut } from './api';
import { LISTING_CAP } from './constants';
import { MY_LISTINGS_KEY } from './useMyListings';

export function useRenewListing(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => renewListing(id),
    onSuccess: (updated) => {
      // The server cleared the closure answer, which `ListingOut` does not carry (0011a).
      queryClient.setQueryData<MyListingOut[]>(MY_LISTINGS_KEY, (old) =>
        old?.map((listing) =>
          listing.id === updated.id
            ? { ...listing, ...updated, close_reason: null, final_rent_ils: null }
            : listing,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: ['listing', updated.id] });
    },
  });
}

/** The alert text for a failed pause, resume or renewal: by the 409's `detail`, else generic. */
export function actionErrorText(t: TFunction, error: unknown, online: boolean): string {
  const detail = error instanceof ApiError ? error.detail : undefined;
  if (detail === 'listing_cap_reached')
    return t('listings.errors.capReached', { cap: LISTING_CAP });
  if (detail === 'renewal_not_open') return t('listings.renew.notOpen');
  if (detail === 'listing_expired') return t('listings.errors.expired');
  return online ? t('common.error') : t('common.offline');
}
