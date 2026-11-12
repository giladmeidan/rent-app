import { useTranslation } from 'react-i18next';

import type { ApplicantStatus } from '../applicants/api';
import { Badge, type BadgeTone } from '../../components/Badge';
import type { ApplicationStatus } from './api';

type Props =
  { viewer?: 'seeker'; status: ApplicationStatus } | { viewer: 'owner'; status: ApplicantStatus };

// The seeker's badges. The brand allows one accent-filled element per screen, so none is solid;
// the words carry each status.
const seekerTone: Record<ApplicationStatus, BadgeTone> = {
  submitted: 'neutral',
  shortlisted: 'accent',
  declined: 'neutral',
  withdrawn: 'neutral',
};

// The owner's badges (brand: colour only repeats the words). "New" draws the eye, as the artboard's
// amber did; a shortlisted one is the positive status; a declined one is quiet.
const ownerTone: Record<ApplicantStatus, BadgeTone> = {
  submitted: 'accent',
  shortlisted: 'success',
  declined: 'neutral',
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
