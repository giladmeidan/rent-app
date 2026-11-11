import { useMutation, useQueryClient } from '@tanstack/react-query';

import { patchListing, type ListingPatch, type MyListingOut } from './api';
import { MY_LISTINGS_KEY } from './useMyListings';

export function usePatchListing(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ListingPatch) => patchListing(id, body),
    onSuccess: (updated) => {
      // The PATCH answers a `ListingOut` without the applicant counts: merge it into the row.
      queryClient.setQueryData<MyListingOut[]>(MY_LISTINGS_KEY, (old) =>
        old?.map((listing) => (listing.id === updated.id ? { ...listing, ...updated } : listing)),
      );
      void queryClient.invalidateQueries({ queryKey: ['listing', updated.id] });
    },
  });
}
