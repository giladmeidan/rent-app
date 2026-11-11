import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { ApiError } from '../listings/api';

export type LikeOut = components['schemas']['LikeOut'];
export type LikeStateOut = components['schemas']['LikeStateOut'];
export type LikedRoomOut = components['schemas']['LikedRoomOut'];
export type MyLikesOut = components['schemas']['MyLikesOut'];

/** The caller's likes: rooms that liked them (`liked_me`) and rooms they liked (`mine`). */
export async function fetchMyLikes(): Promise<MyLikesOut> {
  const { data, error, response } = await api.GET('/me/likes');
  if (data === undefined) throw new ApiError('GET', '/me/likes', response.status, error);
  return data;
}

/** Likes a room. 409 (`room_section_required`, `seeker_profile_required`, `room_gender_mismatch`,
 * `already_applied`), 404, 429, 401 throw. */
export async function likeRoom(listingId: string): Promise<LikeOut> {
  const { data, error, response } = await api.PUT('/listings/{listing_id}/like', {
    params: { path: { listing_id: listingId } },
  });
  if (data === undefined) throw new ApiError('PUT', '/listings/{id}/like', response.status, error);
  return data;
}

/** Takes a like back (idempotent, 204). */
export async function unlikeRoom(listingId: string): Promise<void> {
  const { error, response } = await api.DELETE('/listings/{listing_id}/like', {
    params: { path: { listing_id: listingId } },
  });
  if (!response.ok) throw new ApiError('DELETE', '/listings/{id}/like', response.status, error);
}
