import { api } from '../../api/client';
import type { components } from '../../api/schema';

export type ListingIn = components['schemas']['ListingIn'];
export type ListingOut = components['schemas']['ListingOut'];
export type ListingPatch = components['schemas']['ListingPatch'];
/** An own listing on `GET /me/listings`: `ListingOut` plus its applicant counts (0004c). */
export type MyListingOut = components['schemas']['MyListingOut'];
export type ListingType = ListingOut['listing_type'];
export type ListingStatus = ListingOut['status'];
export type Furnished = ListingOut['furnished'];

/** The create body as the wizard sends it: every key present, `rooms` a JSON number. The owner's
 * preferences (0006a) are left to their server defaults until the wizard's step for them (0006e). */
export type ListingInBody = Required<
  Omit<ListingIn, 'rooms' | 'accepted_households' | 'smoking_allowed' | 'min_contract_months'>
> & { rooms: number };

/** A non-2xx answer. A network failure is the `TypeError` fetch throws, never this. */
export class ApiError extends Error {
  readonly status: number;
  /** The body's `detail`: a code string such as `listing_cap_reached`, or FastAPI's error list. */
  readonly detail: unknown;

  constructor(method: string, path: string, status: number, body: unknown) {
    super(`${method} ${path}: HTTP ${String(status)}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail =
      typeof body === 'object' && body !== null && 'detail' in body ? body.detail : undefined;
  }
}

export async function createListing(body: ListingInBody): Promise<ListingOut> {
  const { data, error, response } = await api.POST('/listings', { body });
  if (data === undefined) throw new ApiError('POST', '/listings', response.status, error);
  return data;
}

export async function fetchMyListings(): Promise<MyListingOut[]> {
  const { data, error, response } = await api.GET('/me/listings');
  if (data === undefined) throw new ApiError('GET', '/me/listings', response.status, error);
  return data;
}

export async function patchListing(id: string, body: ListingPatch): Promise<ListingOut> {
  const { data, error, response } = await api.PATCH('/listings/{listing_id}', {
    params: { path: { listing_id: id } },
    body,
  });
  if (data === undefined) throw new ApiError('PATCH', '/listings/{id}', response.status, error);
  return data;
}

export type ListingPublic = components['schemas']['ListingPublic'];
/** `ListingPublic` plus the exact applicant count (0004a), on `GET /listings/{id}` only. */
export type ListingDetail = components['schemas']['ListingDetail'];

/** A live listing as anyone sees it. 404 (not live, or unknown) and 422 (malformed id) throw. */
export async function fetchPublicListing(id: string): Promise<ListingDetail> {
  const { data, error, response } = await api.GET('/listings/{listing_id}', {
    params: { path: { listing_id: id } },
  });
  if (data === undefined) throw new ApiError('GET', '/listings/{id}', response.status, error);
  return data;
}
