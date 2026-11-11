import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { useMe } from '../auth/useMe';
import { useProfile } from '../profile/useProfile';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** One line inviting a seeker without a housing profile to fill one, and come back here. Nothing
 * for a visitor or an owner (who never request the profile), nor while the profile loads. */
export function ProfileNudge() {
  const { t } = useTranslation();
  const location = useLocation();
  const me = useMe();
  const isSeeker = me.data?.role === 'seeker';
  const profile = useProfile(isSeeker);
  if (!isSeeker || profile.data !== null) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 rounded-2xl bg-accent-tint px-4 py-1 text-start text-sm text-ink">
      <p className="py-2">{t('match.nudge')}</p>
      <Link
        to={`/me/profile?next=${encodeURIComponent(location.pathname + location.search)}`}
        className={`inline-flex min-h-[44px] items-center rounded-full font-bold text-accent-text underline underline-offset-4 ${focusRing}`}
      >
        {t('match.fillProfile')}
      </Link>
    </div>
  );
}
