import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { focusRing } from '../../components/focusRing';
import { useMe } from '../auth/useMe';
import { useProfile } from '../profile/useProfile';

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
    <div className="flex flex-wrap items-center gap-x-3 rounded-lg bg-accent-soft px-4 py-1 text-start text-body-sm text-ink">
      <p className="py-2">{t('match.nudge')}</p>
      <Link
        to={`/me/profile?next=${encodeURIComponent(location.pathname + location.search)}`}
        className={`inline-flex min-h-tap items-center rounded-full font-medium text-accent-strong underline underline-offset-4 ${focusRing}`}
      >
        {t('match.fillProfile')}
      </Link>
    </div>
  );
}
