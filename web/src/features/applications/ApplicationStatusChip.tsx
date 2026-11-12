import { useTranslation } from 'react-i18next';

import type { ApplicantStatus } from '../applicants/api';
import type { ApplicationStatus } from './api';

type Props =
  { viewer?: 'seeker'; status: ApplicationStatus } | { viewer: 'owner'; status: ApplicantStatus };

const seekerTone: Record<ApplicationStatus, string> = {
  submitted: 'bg-accent-soft text-accent-strong',
  shortlisted: 'bg-accent text-on-ink',
  declined: 'bg-border text-ink-muted',
  withdrawn: 'bg-border text-ink-muted',
};

// Inbox.dc.html: "חדש" is amber, "ברשימה הקצרה" accent.
const ownerTone: Record<ApplicantStatus, string> = {
  submitted: 'bg-surface-subtle text-warning',
  shortlisted: 'bg-accent-soft text-accent-strong',
  declined: 'bg-border text-ink-muted',
};

/** One pill per application status (`StatusBadge`'s anatomy), in the seeker's or the owner's words. */
export function ApplicationStatusChip(props: Props) {
  const { t } = useTranslation();
  let label: string;
  let tone: string;
  if (props.viewer === 'owner') {
    const labels: Record<ApplicantStatus, string> = {
      submitted: t('applicants.status.submitted'),
      shortlisted: t('applicants.status.shortlisted'),
      declined: t('applicants.status.declined'),
    };
    label = labels[props.status];
    tone = ownerTone[props.status];
  } else {
    const labels: Record<ApplicationStatus, string> = {
      submitted: t('applications.status.submitted'),
      shortlisted: t('applications.status.shortlisted'),
      declined: t('applications.status.declined'),
      withdrawn: t('applications.status.withdrawn'),
    };
    label = labels[props.status];
    tone = seekerTone[props.status];
  }
  return (
    <span
      data-testid="application-status"
      className={`shrink-0 rounded-full px-3 py-[5px] text-[13px] font-bold ${tone}`}
    >
      {label}
    </span>
  );
}
