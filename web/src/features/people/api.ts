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

/** A person's card in people browse and on `/me/people-likes` (0010h): `card_id` is the only id. */
export type PersonCardOut = components['schemas']['PersonCardOut'];
export type PeopleBrowseOut = components['schemas']['PeopleBrowseOut'];
/** The result of a person like: `conversation_id` is set only when it made the pair mutual. */
export type PersonLikeOut = components['schemas']['PersonLikeOut'];
export type PersonMatchOut = components['schemas']['PersonMatchOut'];
export type MyPeopleLikesOut = components['schemas']['MyPeopleLikesOut'];

/** One page (20) of the people shown in שוק השותפים. 403 `card_required` (no visible card of the
 * caller's own, spec 0010m) and 429 `rate_limited` throw. */
export async function fetchPeopleBrowse(offset: number): Promise<PeopleBrowseOut> {
  const { data, error, response } = await api.GET('/people', {
    params: { query: { offset } },
  });
  if (data === undefined) throw new ApiError('GET', '/people', response.status, error);
  return data;
}

/** Likes a person's card (idempotent). 403 `card_required`, 404 (gone) and 429 throw. */
export async function likePersonCard(cardId: string): Promise<PersonLikeOut> {
  const { data, error, response } = await api.PUT('/people/{card_id}/like', {
    params: { path: { card_id: cardId } },
  });
  if (data === undefined) {
    throw new ApiError('PUT', '/people/{id}/like', response.status, error, response.headers);
  }
  return data;
}

/** Takes the like back (204). 409 `mutual_match` throws (the pair is a match: remove it). */
export async function unlikePersonCard(cardId: string): Promise<void> {
  const { error, response } = await api.DELETE('/people/{card_id}/like', {
    params: { path: { card_id: cardId } },
  });
  if (!response.ok)
    throw new ApiError('DELETE', '/people/{id}/like', response.status, error, response.headers);
}

/** The people who liked the caller, the people the caller liked, and the matches. 403
 * `card_required` throws. */
export async function fetchMyPeopleLikes(): Promise<MyPeopleLikesOut> {
  const { data, error, response } = await api.GET('/me/people-likes');
  if (data === undefined) throw new ApiError('GET', '/me/people-likes', response.status, error);
  return data;
}

/** Ends a match: the direct chat stays readable and closes (204, idempotent). 404 throws. */
export async function removeMatch(conversationId: string): Promise<void> {
  const { error, response } = await api.DELETE('/me/matches/{conversation_id}', {
    params: { path: { conversation_id: conversationId } },
  });
  if (!response.ok) throw new ApiError('DELETE', '/me/matches/{id}', response.status, error);
}
