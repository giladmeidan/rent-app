import { useMutation, useQueryClient } from '@tanstack/react-query';

import { putClosure, type ClosureIn, type MyListingOut } from './api';
import { MY_LISTINGS_KEY } from './useMyListings';

/** The owner's closure answer (0014b). The PUT answers 204: the sent values go into the row. */
export function useSaveClosure(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ClosureIn) => putClosure(id, body),
    onSuccess: (_, body) => {
      queryClient.setQueryData<MyListingOut[]>(MY_LISTINGS_KEY, (old) =>
        old?.map((listing) =>
          listing.id === id
            ? { ...listing, close_reason: body.reason, final_rent_ils: body.final_rent_ils ?? null }
            : listing,
        ),
      );
    },
  });
}
