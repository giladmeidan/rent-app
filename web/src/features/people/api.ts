import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { ApiError } from '../listings/api';

/** A seeker as a room's lister sees them (0008a): no budget amount, no user id; `id` is the pair's. */
export type PersonOut = components['schemas']['PersonOut'];
export type PeoplePageOut = components['schemas']['PeoplePageOut'];
/** The result of a like: `application_id` is set only when it made the pair mutual. */
export type LikeOut = components['schemas']['LikeOut'];

/** Under `['me', …]`: per-user data, removed from the cache on logout (`clearSession`). */
export const peopleKey = (listingId: string) => ['me', 'people', listingId] as const;

/** One page (20) of the people for the caller's room, liked-me first then by match. 404 (not the
 * caller's room) and 409 `listing_not_live` throw. */
export async function fetchPeople(listingId: string, offset: number): Promise<PeoplePageOut> {
  const { data, error, response } = await api.GET('/listings/{listing_id}/people', {
    params: { path: { listing_id: listingId }, query: { offset } },
  });
  if (data === undefined) {
    throw new ApiError('GET', '/listings/{id}/people', response.status, error);
  }
  return data;
}

/** The lister likes a person for the room. 404, 409 (`listing_not_live`, `already_applied`) and 429
 * throw. */
export async function likePerson(listingId: string, personId: string): Promise<LikeOut> {
  const { data, error, response } = await api.PUT(
    '/listings/{listing_id}/people/{person_id}/like',
    { params: { path: { listing_id: listingId, person_id: personId } } },
  );
  if (data === undefined) {
    throw new ApiError('PUT', '/listings/{id}/people/{id}/like', response.status, error);
  }
  return data;
}

/** Takes the like back (204). 404 throws. */
export async function unlikePerson(listingId: string, personId: string): Promise<void> {
  const { error, response } = await api.DELETE('/listings/{listing_id}/people/{person_id}/like', {
    params: { path: { listing_id: listingId, person_id: personId } },
  });
  if (!response.ok) {
    throw new ApiError('DELETE', '/listings/{id}/people/{id}/like', response.status, error);
  }
}
