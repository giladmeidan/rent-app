import { useMutation, useQueryClient } from '@tanstack/react-query';

import { patchListing, type ListingOut, type ListingPatch } from './api';
import { MY_LISTINGS_KEY } from './useMyListings';

export function usePatchListing(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ListingPatch) => patchListing(id, body),
    onSuccess: (updated) => {
      queryClient.setQueryData<ListingOut[]>(MY_LISTINGS_KEY, (old) =>
        old?.map((listing) => (listing.id === updated.id ? updated : listing)),
      );
    },
  });
}
