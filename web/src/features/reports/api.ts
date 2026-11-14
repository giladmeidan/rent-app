import { api } from '../../api/client';
import type { components } from '../../api/schema';
import { ApiError } from '../listings/api';

export type ReportIn = components['schemas']['ReportIn'];
export type ReportOut = components['schemas']['ReportOut'];
export type ReportTargetType = ReportIn['target_type'];
export type ReportReason = ReportIn['reason'];

/** Reports a target (spec 0011b): 201 stored, 200 `already_reported`. 404, 422, 429, … throw. */
export async function postReport(body: ReportIn): Promise<ReportOut> {
  const { data, error, response } = await api.POST('/reports', { body });
  if (data === undefined) {
    throw new ApiError('POST', '/reports', response.status, error, response.headers);
  }
  return data;
}
