import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { ApiError } from '../listings/api';

export type MyApplicationOut = components['schemas']['MyApplicationOut'];
export type ApplicationStatus = MyApplicationOut['status'];

/** A seeker applies to a live listing. 409 `already_applied`, 429 `rate_limited`, … throw. */
export async function applyToListing(
  listingId: string,
  message: string,
): Promise<MyApplicationOut> {
  const { data, error, response } = await api.POST('/listings/{listing_id}/applications', {
    params: { path: { listing_id: listingId } },
    body: { message },
  });
  if (data === undefined) {
    throw new ApiError(
      'POST',
      '/listings/{id}/applications',
      response.status,
      error,
      response.headers,
    );
  }
  return data;
}

/** The caller's own applications, in the API's order. */
export async function fetchMyApplications(): Promise<MyApplicationOut[]> {
  const { data, error, response } = await api.GET('/me/applications');
  if (data === undefined) throw new ApiError('GET', '/me/applications', response.status, error);
  return data;
}

/** Withdraws one of the caller's own applications. 409 `not_withdrawable`, 404 throw. */
export async function withdrawApplication(id: string): Promise<MyApplicationOut> {
  const { data, error, response } = await api.POST('/me/applications/{application_id}/withdraw', {
    params: { path: { application_id: id } },
  });
  if (data === undefined) {
    throw new ApiError('POST', '/me/applications/{id}/withdraw', response.status, error);
  }
  return data;
}

/** True for an `ApiError` with this status. */
export function hasStatus(error: unknown, status: number): boolean {
  return error instanceof ApiError && error.status === status;
}
