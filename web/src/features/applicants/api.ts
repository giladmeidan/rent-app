import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { ApiError } from '../listings/api';

/** One applicant to the owner's listing (0004c): name, status and message, plus its match and
 * housing summary (0006c, `null` for an applicant from before Slice 6); no email, no user id. */
export type ApplicantOut = components['schemas']['ApplicantOut'];
/** What an owner sees and sets: `withdrawn` applications are never listed. */
export type ApplicantStatus = ApplicantOut['status'];
/** The applicant's housing summary (0006c): no budget, no areas. `move_in_date` may be past. */
export type ApplicantProfileOut = components['schemas']['ApplicantProfileOut'];
/** The applicant's room section (0007c), only on an application made to a room: gender, the age
 * this year (`null` when not given) and the answered questionnaire keys. Never a birth year. */
export type ApplicantRoom = NonNullable<ApplicantOut['room']>;

/** The applicants of one of the caller's listings, in the API's default order (best match first,
 * 0006c). 404 (not theirs) throws. */
export async function fetchApplicants(listingId: string): Promise<ApplicantOut[]> {
  const { data, error, response } = await api.GET('/listings/{listing_id}/applications', {
    params: { path: { listing_id: listingId } },
  });
  if (data === undefined) {
    throw new ApiError('GET', '/listings/{id}/applications', response.status, error);
  }
  return data;
}

/** Shortlists, un-shortlists (`submitted`) or declines an applicant. 404 (withdrawn or not this
 * listing's) and 409 `invalid_transition` (declined) throw. */
export async function setApplicantStatus(
  listingId: string,
  applicationId: string,
  status: ApplicantStatus,
): Promise<ApplicantOut> {
  const { data, error, response } = await api.PATCH(
    '/listings/{listing_id}/applications/{application_id}',
    {
      params: { path: { listing_id: listingId, application_id: applicationId } },
      body: { status },
    },
  );
  if (data === undefined) {
    throw new ApiError('PATCH', '/listings/{id}/applications/{id}', response.status, error);
  }
  return data;
}
