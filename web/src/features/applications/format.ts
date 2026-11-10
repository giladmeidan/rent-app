import { formatDate, todayInIsrael } from '../listings/format';
import type { ApplicationStatus } from './api';

/** An application's `created_at` as the Israeli calendar day it was sent, e.g. `11.11.26`. */
export function appliedOn(createdAt: string): string {
  return formatDate(todayInIsrael(new Date(createdAt)));
}

/** Submitted and shortlisted applications can be withdrawn; declined and withdrawn ones cannot. */
export const isWithdrawable = (status: ApplicationStatus) =>
  status === 'submitted' || status === 'shortlisted';
