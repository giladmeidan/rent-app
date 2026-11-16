import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createTourWindow, deleteTourWindow, fetchTourWindows, type TourWindowIn } from './api';

/** Under `['me', …]`, so logout removes it with the other per-user data. */
export const tourWindowsKey = (listingId: string) => ['me', 'tours', 'windows', listingId] as const;

/** The lister's upcoming windows of one listing; `enabled = false` sends nothing. */
export function useTourWindows(listingId: string, enabled: boolean) {
  return useQuery({
    queryKey: tourWindowsKey(listingId),
    queryFn: () => fetchTourWindows(listingId),
    enabled,
    retry: false,
  });
}

export function useCreateTourWindow(listingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: TourWindowIn) => createTourWindow(listingId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tourWindowsKey(listingId) }),
  });
}

export function useDeleteTourWindow(listingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (windowId: string) => deleteTourWindow(windowId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: tourWindowsKey(listingId) }),
  });
}
