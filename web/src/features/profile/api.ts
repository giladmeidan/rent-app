import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { ApiError } from '../listings/api';

export type SeekerProfileIn = components['schemas']['SeekerProfileIn'];
export type SeekerProfileOut = components['schemas']['SeekerProfileOut'];
export type Household = SeekerProfileOut['household'];
export type ContractMonths = SeekerProfileOut['contract_months'];
/** The seeker's own gender (the profile's room section); `null` on the profile means no section. */
export type Gender = NonNullable<SeekerProfileOut['gender']>;
/** Who the seeker prefers to live with; also a room listing's "who it is for" (0007e). */
export type FlatmateGender = SeekerProfileOut['flatmate_gender'];

/** The caller's housing profile, or `null` when there is none yet (404 `seeker_profile_not_found`).
 * Every other failure throws: an `ApiError`, or the `TypeError` of a network failure. */
export async function fetchProfile(): Promise<SeekerProfileOut | null> {
  const { data, error, response } = await api.GET('/me/profile');
  if (data !== undefined) return data;
  const failure = new ApiError('GET', '/me/profile', response.status, error);
  if (failure.status === 404 && failure.detail === 'seeker_profile_not_found') return null;
  throw failure;
}

/** Creates or replaces the caller's profile. 422 (a list, or `unknown_area`), 401, … throw. */
export async function putProfile(body: SeekerProfileIn): Promise<SeekerProfileOut> {
  const { data, error, response } = await api.PUT('/me/profile', { body });
  if (data === undefined) throw new ApiError('PUT', '/me/profile', response.status, error);
  return data;
}
