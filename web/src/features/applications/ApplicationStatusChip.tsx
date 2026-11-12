import { useTranslation } from 'react-i18next';

import type { ApplicantStatus } from '../applicants/api';
import { Badge, type BadgeTone } from '../../components/Badge';
import type { ApplicationStatus } from './api';

type Props =
  { viewer?: 'seeker'; status: ApplicationStatus } | { viewer: 'owner'; status: ApplicantStatus };

const seekerTone: Record<ApplicationStatus, string> = {
  submitted: 'bg-accent-soft text-accent-strong',
  shortlisted: 'bg-accent text-on-ink',
  declined: 'bg-border text-ink-muted',
  withdrawn: 'bg-border text-ink-muted',
};

// The owner's badges (brand: colour only repeats the words). "New" draws the eye, as the artboard's
// amber did; a shortlisted one is the positive status; a declined one is quiet.
const ownerTone: Record<ApplicantStatus, BadgeTone> = {
  submitted: 'accent',
  shortlisted: 'success',
  declined: 'neutral',
};

/** One pill per application status (`StatusBadge`'s anatomy), in the seeker's or the owner's words.
 * The owner's is the kit's `Badge`; the seeker's is unchanged. */
export function ApplicationStatusChip(props: Props) {
  const { t } = useTranslation();
  if (props.viewer === 'owner') {
    const labels: Record<ApplicantStatus, string> = {
      submitted: t('applicants.status.submitted'),
      shortlisted: t('applicants.status.shortlisted'),
      declined: t('applicants.status.declined'),
    };
    return (
      <Badge tone={ownerTone[props.status]} data-testid="application-status">
        {labels[props.status]}
      </Badge>
    );
  }
  const labels: Record<ApplicationStatus, string> = {
    submitted: t('applications.status.submitted'),
    shortlisted: t('applications.status.shortlisted'),
    declined: t('applications.status.declined'),
    withdrawn: t('applications.status.withdrawn'),
  };
  return (
    <span
      data-testid="application-status"
      className={`shrink-0 rounded-full px-3 py-[5px] text-[13px] font-bold ${seekerTone[props.status]}`}
    >
      {labels[props.status]}
    </span>
  );
}
