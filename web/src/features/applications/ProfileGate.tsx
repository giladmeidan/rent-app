import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { profileHref } from '../profile/links';

/** A seeker without the profile's looking part (no profile, or only "עליי"; 0010c): why, and the
 * way to fill it in and come back here. */
export function ProfileGate({ listingId }: { listingId: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-3">
      <p tabIndex={-1} className="text-start text-body focus:outline-none">
        {t('applications.profileRequired')}
      </p>
      <Button
        variant="primary"
        size="lg"
        fullWidth
        to={profileHref(`/listings/${listingId}`, 'looking')}
      >
        {t('applications.fillProfile')}
      </Button>
    </div>
  );
}
