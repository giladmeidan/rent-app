import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { ApiError } from '../listings/api';

export type SeekerProfileIn = components['schemas']['SeekerProfileIn'];
export type SeekerProfileOut = components['schemas']['SeekerProfileOut'];
export type Household = NonNullable<SeekerProfileOut['household']>;
export type ContractMonths = NonNullable<SeekerProfileOut['contract_months']>;
/** The account's own gender (the profile's personal part, "עליי"); `null` on the profile means no
 * personal part (0010c). */
export type Gender = NonNullable<SeekerProfileOut['gender']>;
/** Who the seeker prefers to live with; also a room listing's "who it is for" (0007e). */
export type FlatmateGender = SeekerProfileOut['flatmate_gender'];
/** Whether the seeker needs a protected space (0015b): none / ממ״ד, ממ״ק or מקלט / a ממ״ד in the flat. */
export type ShelterNeeded = SeekerProfileOut['shelter_needed'];

/** A profile whose "what I am looking for" part is filled (0010c): its 7 looking fields are set. */
export type LookingProfile = SeekerProfileOut & {
  budget_max_ils: number;
  move_in_date: string;
  area_ids: string[];
  household: Household;
  has_pets: boolean;
  smoker: boolean;
  contract_months: ContractMonths;
};

/** Whether `p` has the looking part (the API stores the 7 fields all or none; a `null` budget means
 * none). Needed to apply, to like a room and for a match score. */
export function hasLooking(p: SeekerProfileOut | null | undefined): p is LookingProfile {
  return p?.budget_max_ils != null;
}

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
  if (data === undefined)
    throw new ApiError('PUT', '/me/profile', response.status, error, response.headers);
  return data;
}
