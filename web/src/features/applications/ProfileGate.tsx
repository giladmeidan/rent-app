import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';

/** A seeker with no housing profile: why, and the way to fill one in and come back here. */
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
        to={`/me/profile?next=${encodeURIComponent(`/listings/${listingId}`)}`}
      >
        {t('applications.fillProfile')}
      </Button>
    </div>
  );
}
