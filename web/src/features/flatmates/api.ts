import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { CONVERSATIONS_KEY } from '../chat/useConversations';
import { ApiError } from '../listings/api';
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

/** Creates or rotates the link; "my listings" (`flatmate_invite_active`) refetches either way. */
export function useCreateInvite(listingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => createInvite(listingId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: MY_LISTINGS_KEY }),
  });
}

/** Turns the link off; "my listings" refetches. */
export function useDisableInvite(listingId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => disableInvite(listingId),
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
 * is null. No retry: a 404 or 429 is the answer. */
export function useInvitePreview(token: string | null) {
  return useQuery({
    queryKey: previewKey(token ?? ''),
    queryFn: () => previewInvite(token ?? ''),
    enabled: token !== null,
    retry: false,
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
      ]);
    },
  });
}
