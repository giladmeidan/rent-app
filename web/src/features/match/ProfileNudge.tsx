import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { useSide } from '../../app/side';
import { focusRing } from '../../components/focusRing';
import { useMe } from '../auth/useMe';
import { hasLooking } from '../profile/api';
import { profileHref } from '../profile/links';
import { useProfile } from '../profile/useProfile';

/** One line inviting someone without the profile's looking part (0010c: no profile, or only the
 * personal part) to fill it, and come back here: any signed-in account on the market side (no roles
 * there, spec 0010b), a seeker on the apartments side. Nothing for a visitor or an owner on the
 * apartments side (who never request the profile), nor while the profile loads. */
export function ProfileNudge() {
  const { t } = useTranslation();
  const location = useLocation();
  const me = useMe();
  const side = useSide();
  const eligible = me.data != null && (side === 'market' || me.data.role === 'seeker');
  const profile = useProfile(eligible);
  if (!eligible || profile.data === undefined || hasLooking(profile.data)) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 rounded-lg bg-accent-soft px-4 py-1 text-start text-body-sm text-ink">
      <p className="py-2">{t('match.nudge')}</p>
      <Link
        to={profileHref(location.pathname + location.search, 'looking')}
        className={`inline-flex min-h-tap items-center rounded-full font-medium text-accent-strong underline underline-offset-4 ${focusRing}`}
      >
        {t('match.fillProfile')}
      </Link>
    </div>
  );
}
