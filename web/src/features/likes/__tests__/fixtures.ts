// Fixtures for the likes tests; the fetch mock and render helpers are the auth harness's.
import { publicListing } from '../../search/__tests__/fixtures';
import type { LikedRoomOut, MyLikesOut } from '../api';

/** A room on `GET /me/likes`. */
export function likedRoom(overrides: Partial<LikedRoomOut['listing']> = {}): LikedRoomOut {
  return {
    listing: publicListing({ listing_type: 'room', flatmates_count: 2, ...overrides }),
    liked_at: '2026-11-11T09:00:00Z',
  };
}

export const myLikes = (liked_me: LikedRoomOut[], mine: LikedRoomOut[]): MyLikesOut => ({
  liked_me,
  mine,
});
