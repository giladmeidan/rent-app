import { useMutation, useQueryClient } from '@tanstack/react-query';

import { patchListing, type ListingPatch, type MyListingOut } from './api';
import { MY_LISTINGS_KEY } from './useMyListings';

export function usePatchListing(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ListingPatch) => patchListing(id, body),
    onSuccess: (updated, body) => {
      // The PATCH answers a `ListingOut` without the applicant counts or the closure answer: merge
      // it into the row. A resume clears the answer on the server (0014b), so here too.
      const resumed = body.status === 'active' ? { close_reason: null, final_rent_ils: null } : {};
      queryClient.setQueryData<MyListingOut[]>(MY_LISTINGS_KEY, (old) =>
        old?.map((listing) =>
          listing.id === updated.id ? { ...listing, ...updated, ...resumed } : listing,
        ),
      );
      void queryClient.invalidateQueries({ queryKey: ['listing', updated.id] });
    },
  });
}
