import { useQuery } from '@tanstack/react-query';

import { fetchTourSlots } from './api';

export const tourSlotsKey = (applicationId: string) =>
  ['me', 'tours', 'slots', applicationId] as const;

/** The free slots of an application's listing (the chat's id is the application's); `enabled =
 * false` sends nothing. */
export function useTourSlots(applicationId: string, enabled: boolean) {
  return useQuery({
    queryKey: tourSlotsKey(applicationId),
    queryFn: () => fetchTourSlots(applicationId),
    enabled,
    retry: false,
  });
}
