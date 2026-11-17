import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { ApiError } from '../listings/api';

/** Whether the caller's calendar feed is on (never the token). */
export type TourFeedOut = components['schemas']['TourFeedOut'];

/** Under `['me', …]`, so a logout removes it (`clearSession`). Holds `{active}` only, never a token. */
export const TOUR_FEED_KEY = ['me', 'tour-feed'] as const;

export async function getTourFeed(): Promise<TourFeedOut> {
  const { data, error, response } = await api.GET('/me/tour-feed');
  if (data === undefined) throw new ApiError('GET', '/me/tour-feed', response.status, error);
  return data;
}

/** Turns the feed on, or rotates it (the old link stops working): the raw token, shown once. */
export async function createTourFeed(): Promise<string> {
  const { data, error, response } = await api.POST('/me/tour-feed');
  if (data === undefined) {
    throw new ApiError('POST', '/me/tour-feed', response.status, error, response.headers);
  }
  return data.token;
}

/** Turns the feed off (204, also when it was off). */
export async function disableTourFeed(): Promise<void> {
  const { error, response } = await api.DELETE('/me/tour-feed');
  if (!response.ok) {
    throw new ApiError('DELETE', '/me/tour-feed', response.status, error, response.headers);
  }
}

/** The feed's three addresses: the plain one, `webcal:` for calendar apps, and Google's add link. */
export function feedUrls(token: string): { https: string; webcal: string; google: string } {
  const https = new URL(`/tour-feed/${token}.ics`, import.meta.env.VITE_API_URL).toString();
  const webcal = https.replace(/^https?:/, 'webcal:');
  const google = 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(webcal);
  return { https, webcal, google };
}

/** The feed's state; `enabled` stays false until the dialog first opens. */
export function useTourFeed(enabled: boolean) {
  return useQuery({ queryKey: TOUR_FEED_KEY, queryFn: getTourFeed, enabled });
}

/** Create / rotate and disable: the cache gets the new `{active}`, never the token. */
export function useTourFeedMutations() {
  const queryClient = useQueryClient();
  const set = (active: boolean) => queryClient.setQueryData<TourFeedOut>(TOUR_FEED_KEY, { active });
  // `gcTime: 0`: the token (the mutation's data) leaves the mutation cache once unobserved.
  const create = useMutation({
    mutationFn: createTourFeed,
    onSuccess: () => set(true),
    gcTime: 0,
  });
  const disable = useMutation({ mutationFn: disableTourFeed, onSuccess: () => set(false) });
  return { create, disable };
}
