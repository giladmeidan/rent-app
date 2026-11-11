import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createListing, type MyListingOut } from './api';
import { MY_LISTINGS_KEY } from './useMyListings';

export function useCreateListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createListing,
    onSuccess: (created) => {
      // The new card shows at once on "my listings" (API order is newest first); the list is marked
      // stale, so that page refetches it in the background. An empty cache stays empty: that page
      // loads it itself. The POST's `ListingOut` has no counts; a new listing has no applicants or likes.
      queryClient.setQueryData<MyListingOut[]>(MY_LISTINGS_KEY, (old) =>
        old
          ? [{ ...created, applicant_count: 0, new_applicant_count: 0, liked_me_count: 0 }, ...old]
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
    },
  });
}
