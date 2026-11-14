import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { parseRetryAfter } from '../../components/retryAfter';

export type ListingIn = components['schemas']['ListingIn'];
export type ListingOut = components['schemas']['ListingOut'];
export type ListingPatch = components['schemas']['ListingPatch'];
/** An own listing on `GET /me/listings`: `ListingOut` plus its applicant counts (0004c). */
export type MyListingOut = components['schemas']['MyListingOut'];
export type ListingType = ListingOut['listing_type'];
export type ListingStatus = ListingOut['status'];
export type Furnished = ListingOut['furnished'];
/** A household the owner accepts (0006a); Pydantic inlines the `Literal`, so the schema names none. */
export type Household = ListingOut['accepted_households'][number];
/** A minimum contract length in months (0006a). */
export type ContractMonths = NonNullable<ListingOut['min_contract_months']>;
/** Who a room is for (0007a); an apartment is always `any`. The schema inlines the `Literal`. */
export type GenderPreference = ListingOut['gender_preference'];
/** One listing photo's addresses (0010d): `small_url` (480 px) and `large_url` (1600 px), WebP. */
export type PhotoOut = components['schemas']['PhotoOut'];

/** Who is behind a room listing (0010f): `lives_here` shows the lister on the room's page. */
export type Poster = NonNullable<ListingOut['poster']>;
/** A room's optional flat facts (0010f): `null` means not said. */
export type RoomFactKey =
  'room_size_sqm' | 'private_bathroom' | 'balcony' | 'bills_included' | 'poster';
/** An apartment's optional facts (0014b), with `balcony`: `null` means not said. */
export type ApartmentFactKey = 'safe_room' | 'air_conditioning' | 'condition';
/** The apartment's condition (0014b). */
export type Condition = NonNullable<ListingOut['condition']>;
/** What happened to a listing that is not live (0014b), private to its owner. */
export type CloseReason = NonNullable<MyListingOut['close_reason']>;
export type ClosureIn = components['schemas']['ClosureIn'];

/** The create body as the wizard sends it: every key present, `rooms` a JSON number; the flat
 * facts for a room, `balcony` and the apartment facts for an apartment. */
export type ListingInBody = Required<Omit<ListingIn, 'rooms' | RoomFactKey | ApartmentFactKey>> & {
  rooms: number;
} & Pick<ListingIn, RoomFactKey | ApartmentFactKey>;

/** A non-2xx answer. A network failure is the `TypeError` fetch throws, never this. */
export class ApiError extends Error {
  readonly status: number;
  /** The body's `detail`: a code string such as `listing_cap_reached`, or FastAPI's error list. */
  readonly detail: unknown;
  /** A 429's `Retry-After` in seconds, when the caller passed the response's headers. */
  readonly retryAfter: number | null;

  constructor(method: string, path: string, status: number, body: unknown, headers?: Headers) {
    super(`${method} ${path}: HTTP ${String(status)}`);
    this.name = 'ApiError';
    this.status = status;
    this.detail =
      typeof body === 'object' && body !== null && 'detail' in body ? body.detail : undefined;
    this.retryAfter = headers === undefined ? null : parseRetryAfter(headers);
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

/** The owner's closure answer (0014b). 204 on success; 409 while the listing is live. */
export async function putClosure(id: string, body: ClosureIn): Promise<void> {
  const { error, response } = await api.PUT('/listings/{listing_id}/closure', {
    params: { path: { listing_id: id } },
    body,
  });
  if (!response.ok) throw new ApiError('PUT', '/listings/{id}/closure', response.status, error);
}

export type ListingPublic = components['schemas']['ListingPublic'];
/** `ListingPublic` plus the exact applicant count (0004a), on `GET /listings/{id}` only. */
export type ListingDetail = components['schemas']['ListingDetail'];
/** A person living in a room's flat, on its page (0010f): the lister who lives there, or a
 * flatmate who chose to be shown. No id of any kind. */
export type FlatPersonOut = components['schemas']['FlatPersonOut'];

/** A live listing as anyone sees it. 404 (not live, or unknown) and 422 (malformed id) throw. */
export async function fetchPublicListing(id: string): Promise<ListingDetail> {
  const { data, error, response } = await api.GET('/listings/{listing_id}', {
    params: { path: { listing_id: id } },
  });
  if (data === undefined) throw new ApiError('GET', '/listings/{id}', response.status, error);
  return data;
}

export type RentEstimateOut = components['schemas']['RentEstimateOut'];
export type RentEstimateRange = components['schemas']['RentEstimateRange'];

/** The official average rent for an apartment's facts (0014c); signed in, any role. */
export async function fetchRentEstimate(
  city: string,
  street: string,
  rooms: string,
): Promise<RentEstimateOut> {
  const { data, error, response } = await api.GET('/rent-estimate', {
    params: { query: { city, street, rooms } },
  });
  if (data === undefined) throw new ApiError('GET', '/rent-estimate', response.status, error);
  return data;
}
