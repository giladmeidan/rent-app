import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const primary = `inline-flex min-h-[52px] items-center justify-center rounded-[14px] bg-accent px-5 text-base font-bold text-on-ink ${focusRing}`;

/** A seeker with no housing profile: why, and the way to fill one in and come back here. */
export function ProfileGate({ listingId }: { listingId: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-start text-[15px]">{t('applications.profileRequired')}</p>
      <Link
        to={`/me/profile?next=${encodeURIComponent(`/listings/${listingId}`)}`}
        className={`${primary} w-full`}
      >
        {t('applications.fillProfile')}
      </Link>
    </div>
  );
}
