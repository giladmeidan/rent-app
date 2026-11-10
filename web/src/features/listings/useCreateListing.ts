import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createListing, type ListingOut } from './api';
import { MY_LISTINGS_KEY } from './useMyListings';

export function useCreateListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createListing,
    onSuccess: (created) => {
      // The new card shows at once on "my listings" (API order is newest first); the list is marked
      // stale, so that page refetches it in the background. An empty cache stays empty: that page
      // loads it itself.
      queryClient.setQueryData<ListingOut[]>(MY_LISTINGS_KEY, (old) =>
        old ? [created, ...old] : old,
      );
      void queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
    },
  });
}
