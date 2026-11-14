import { useTranslation } from 'react-i18next';

import type { ApplicantStatus } from '../applicants/api';
import { Badge, type BadgeTone } from '../../components/Badge';
import type { ApplicationStatus } from './api';

type Props =
  { viewer?: 'seeker'; status: ApplicationStatus } | { viewer: 'owner'; status: ApplicantStatus };

// Traffic-light tones, the same on both sides: waiting is amber, shortlisted green, declined red,
// withdrawn grey. The words still carry each status; none is solid (one accent fill per screen).
const seekerTone: Record<ApplicationStatus, BadgeTone> = {
  submitted: 'warning',
  shortlisted: 'success',
  declined: 'danger',
  withdrawn: 'neutral',
};

/** The owner's tones (also the desktop pane's, `ApplicantPane`). */
export const ownerTone: Record<ApplicantStatus, BadgeTone> = {
  submitted: 'warning',
  shortlisted: 'success',
  declined: 'danger',
};

/** One pill per application status (`StatusBadge`'s anatomy), in the seeker's or the owner's words.
 * Both are the kit's `Badge`. */
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
    <Badge
      tone={seekerTone[props.status]}
      size="md"
      data-testid="application-status"
      className="shrink-0"
    >
      {labels[props.status]}
    </Badge>
  );
}
