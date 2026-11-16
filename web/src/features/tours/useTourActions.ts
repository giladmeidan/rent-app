import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { hasStatus } from '../applications/api';
import { CONVERSATIONS_KEY } from '../chat/useConversations';
import { threadKey } from '../chat/useThread';
import { bookTour, cancelTour, rescheduleTour } from './api';
import { AGENDA_KEY } from './useAgenda';
import { tourSlotsKey } from './useTourSlots';

/** A tour change shows as a line in the thread, the list's preview and the tours agenda: refetch all four. */
function refresh(queryClient: QueryClient, conversationId: string) {
  void queryClient.invalidateQueries({ queryKey: threadKey(conversationId), exact: true });
  void queryClient.invalidateQueries({ queryKey: tourSlotsKey(conversationId), exact: true });
  void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY, exact: true });
  void queryClient.invalidateQueries({ queryKey: AGENDA_KEY, exact: true });
}

/** On a 409 the slots (and the thread) are out of date: refetch them. */
function refreshOnConflict(queryClient: QueryClient, conversationId: string, error: unknown) {
  if (hasStatus(error, 409)) refresh(queryClient, conversationId);
}

/** Books the slot starting at `startsAt` in chat (= application) `conversationId`. */
export function useBookTour(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (startsAt: string) => bookTour(conversationId, startsAt),
    onSuccess: () => refresh(queryClient, conversationId),
    onError: (error) => refreshOnConflict(queryClient, conversationId, error),
  });
}

export function useRescheduleTour(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tourId, startsAt }: { tourId: string; startsAt: string }) =>
      rescheduleTour(tourId, startsAt),
    onSuccess: () => refresh(queryClient, conversationId),
    onError: (error) => refreshOnConflict(queryClient, conversationId, error),
  });
}

export function useCancelTour(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tourId: string) => cancelTour(tourId),
    onSuccess: () => refresh(queryClient, conversationId),
    onError: (error) => refreshOnConflict(queryClient, conversationId, error),
  });
}
