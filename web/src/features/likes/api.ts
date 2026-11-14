import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { ApiError } from '../listings/api';

export type LikedRoomOut = components['schemas']['LikedRoomOut'];
export type MyLikesOut = components['schemas']['MyLikesOut'];

/** The caller's invites (spec 0010l): the rooms whose lister liked them and that they have not
 * applied to (`liked_me`). A seeker has no room-like of their own: on a room they apply. */
export async function fetchMyLikes(): Promise<MyLikesOut> {
  const { data, error, response } = await api.GET('/me/likes');
  if (data === undefined) throw new ApiError('GET', '/me/likes', response.status, error);
  return data;
}
