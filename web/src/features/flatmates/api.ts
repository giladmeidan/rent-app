import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { hasStatus } from '../applications/api';
import { clearSession } from '../auth/useLogout';
import { CONVERSATIONS_KEY } from '../chat/useConversations';
import { THREADS_KEY } from '../chat/useThread';
import { ApiError, type MyListingOut } from '../listings/api';
import { MY_LISTINGS_KEY } from '../listings/useMyListings';

/** A new invite link's token: returned by the create / rotate POST only, never readable again. */
export type InviteOut = components['schemas']['InviteOut'];
/** One flatmate of the owner's room; `id` is the membership's (remove by it). */
export type FlatmateOut = components['schemas']['FlatmateOut'];
/** What an invited person sees before joining: the room, the owner's name, `member`. */
export type InvitePreviewOut = components['schemas']['InvitePreviewOut'];
export type JoinOut = components['schemas']['JoinOut'];
/** One flat the caller is a flatmate of (`GET /me/flats`, read by 0008f). */
export type MyFlatOut = components['schemas']['MyFlatOut'];

/** Under `['me', …]`: per-user data, removed from the cache on logout (`clearSession`). */
export const flatmatesKey = (listingId: string) => ['me', 'flatmates', listingId] as const;
/** The flats the caller has joined (0008f reads it; a join invalidates it). */
export const MY_FLATS_KEY = ['me', 'flats'] as const;
/** The preview of one invite. In memory only: the token is in no URL (0008e A1). */
const previewKey = (token: string) => ['me', 'flatmate-invite', token] as const;

/** Creates the room's invite link, or rotates it (the old link stops working). 404 throws. */
export async function createInvite(listingId: string): Promise<InviteOut> {
  const { data, error, response } = await api.POST('/listings/{listing_id}/flatmate-invite', {
    params: { path: { listing_id: listingId } },
  });
  if (data === undefined) {
    throw new ApiError('POST', '/listings/{id}/flatmate-invite', response.status, error);
  }
  return data;
}

/** Turns the room's invite link off (204). 404 throws. */
export async function disableInvite(listingId: string): Promise<void> {
  const { error, response } = await api.DELETE('/listings/{listing_id}/flatmate-invite', {
    params: { path: { listing_id: listingId } },
  });
  if (!response.ok) {
    throw new ApiError('DELETE', '/listings/{id}/flatmate-invite', response.status, error);
  }
}

/** The room's flatmates, by `joined_at`. 404 throws. */
export async function fetchFlatmates(listingId: string): Promise<FlatmateOut[]> {
  const { data, error, response } = await api.GET('/listings/{listing_id}/flatmates', {
    params: { path: { listing_id: listingId } },
  });
  if (data === undefined) {
    throw new ApiError('GET', '/listings/{id}/flatmates', response.status, error);
  }
  return data;
}

/** Removes a flatmate (204); the API also turns the invite link off. 404 throws. */
export async function removeFlatmate(listingId: string, flatmateId: string): Promise<void> {
  const { error, response } = await api.DELETE('/listings/{listing_id}/flatmates/{flatmate_id}', {
    params: { path: { listing_id: listingId, flatmate_id: flatmateId } },
  });
  if (!response.ok) {
    throw new ApiError('DELETE', '/listings/{id}/flatmates/{id}', response.status, error);
  }
}

/** The invite's preview, the token in the body. 404, 409 `own_listing`, 422 and 429 throw. */
export async function previewInvite(token: string): Promise<InvitePreviewOut> {
  const { data, error, response } = await api.POST('/flatmate-invites/preview', {
    body: { token },
  });
  if (data === undefined) {
    throw new ApiError('POST', '/flatmate-invites/preview', response.status, error);
  }
  return data;
}

/** Joins the flat, the token in the body. 404, 409 (`own_listing`, `already_applied`, `declined`,
 * `flatmates_full`), 422 and 429 throw. A member gets 200 again. */
export async function joinFlat(token: string): Promise<JoinOut> {
  const { data, error, response } = await api.POST('/flatmate-invites/join', { body: { token } });
  if (data === undefined) {
    throw new ApiError('POST', '/flatmate-invites/join', response.status, error);
  }
  return data;
}

/** Sets the room's `flatmate_invite_active` in the cached "my listings". */
function setInviteActive(queryClient: QueryClient, listingId: string, active: boolean) {
  queryClient.setQueryData<MyListingOut[]>(MY_LISTINGS_KEY, (listings) =>
    listings?.map((l) => (l.id === listingId ? { ...l, flatmate_invite_active: active } : l)),
  );
}

/** Creates or rotates the link; "my listings" (`flatmate_invite_active`) refetches either way.
 * Not awaited: the caller shows the new token at once, and a shown token wins over the state. */
export function useCreateInvite(listingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => createInvite(listingId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY });
    },
  });
}

/** Turns the link off: the cached state turns off at once (no flash of the active-link block),
 * then "my listings" refetches, and the mutation settles once it is back. */
export function useDisableInvite(listingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disableInvite(listingId),
    onSuccess: () => setInviteActive(queryClient, listingId, false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY }),
  });
}

/** The room's flatmates. Pass `enabled = false` until the listing is known to be the owner's
 * room, so an unknown id sends no request. */
export function useFlatmates(listingId: string, enabled = true) {
  return useQuery({
    queryKey: flatmatesKey(listingId),
    queryFn: () => fetchFlatmates(listingId),
    enabled,
  });
}

/** Removes a flatmate; the list and "my listings" (the count, and the link the API turned off)
 * refetch. */
export function useRemoveFlatmate(listingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (flatmateId: string) => removeFlatmate(listingId, flatmateId),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: flatmatesKey(listingId), exact: true }),
        queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY }),
      ]),
  });
}

/** The preview of the invite `token` (a POST, never the token in a URL), or nothing while `token`
 * is null. No retry and no refetch on focus or reconnect: each POST spends the rate-limit budget,
 * and a 404 or 429 is the answer. */
export function useInvitePreview(token: string | null) {
  return useQuery({
    queryKey: previewKey(token ?? ''),
    queryFn: () => previewInvite(token ?? ''),
    enabled: token !== null,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
}

/** Joins the flat of `token`; the chats and "my flats" refetch on success. */
export function useJoinFlat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => joinFlat(token),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }),
        queryClient.invalidateQueries({ queryKey: MY_FLATS_KEY }),
        queryClient.invalidateQueries({ queryKey: THREADS_KEY }),
      ]);
    },
  });
}

/** The flats the caller is a flatmate of (`GET /me/flats`), newest join first as the API orders. */
export async function fetchMyFlats(): Promise<MyFlatOut[]> {
  const { data, error, response } = await api.GET('/me/flats');
  if (data === undefined) throw new ApiError('GET', '/me/flats', response.status, error);
  return data;
}

/** Leaves the flat of `listingId` (204). Any non-2xx throws. */
export async function leaveFlat(listingId: string): Promise<void> {
  const { error, response } = await api.DELETE('/me/flats/{listing_id}', {
    params: { path: { listing_id: listingId } },
  });
  if (!response.ok) throw new ApiError('DELETE', '/me/flats/{id}', response.status, error);
}

/** The caller's flats. On an error the chat list hides its link; `MyFlatsPage` shows the error
 * state. A 401 forgets the session. */
export function useMyFlats() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: MY_FLATS_KEY,
    queryFn: async () => {
      try {
        return await fetchMyFlats();
      } catch (error) {
        if (hasStatus(error, 401)) clearSession(queryClient);
        throw error;
      }
    },
  });
}

/** Leaves a flat; the flats and the chats (the room's are gone) refetch. */
export function useLeaveFlat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (listingId: string) => leaveFlat(listingId),
    onError: (error) => {
      if (hasStatus(error, 401)) clearSession(queryClient);
    },
    // Open or cached threads of the flat refetch, to the removed state.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: MY_FLATS_KEY }),
        queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }),
        queryClient.invalidateQueries({ queryKey: THREADS_KEY }),
      ]),
  });
}
