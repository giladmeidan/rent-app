import { useTranslation } from 'react-i18next';

import type { ApplicationStatus } from './api';

const tone: Record<ApplicationStatus, string> = {
  submitted: 'bg-accent-tint text-accent-text',
  shortlisted: 'bg-accent text-white',
  declined: 'bg-line text-muted',
  withdrawn: 'bg-line text-muted',
};

/** One pill per application status (`StatusBadge`'s anatomy). */
export function ApplicationStatusChip({ status }: { status: ApplicationStatus }) {
  const { t } = useTranslation();
  const label = {
    submitted: t('applications.status.submitted'),
    shortlisted: t('applications.status.shortlisted'),
    declined: t('applications.status.declined'),
    withdrawn: t('applications.status.withdrawn'),
  }[status];
  return (
    <span
      data-testid="application-status"
      className={`shrink-0 rounded-full px-3 py-[5px] text-[13px] font-bold ${tone[status]}`}
    >
      {label}
    </span>
  );
}
