import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Skeleton } from '../../components/Skeleton';
import { useLogout } from './useLogout';
import { useMe } from './useMe';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/** Header fragment: who is logged in, or the login / signup links. Never blocks the shell. */
export function AuthMenu() {
  const { t } = useTranslation();
  const me = useMe();
  const logout = useLogout();

  if (me.isPending) {
    return (
      <div className="flex min-h-[44px] items-center" aria-busy="true">
        <Skeleton className="h-5 w-24" />
      </div>
    );
  }

  // A network or server error on /me renders the logged-out state too.
  if (me.isError || me.data === null) {
    return (
      <nav className="flex items-center gap-1">
        <Link
          to="/login"
          className={`inline-flex min-h-[44px] items-center rounded-full px-[14px] text-[15px] font-semibold ${focusRing}`}
        >
          {t('header.login')}
        </Link>
        <Link
          to="/signup"
          className={`inline-flex min-h-[44px] items-center rounded-full bg-accent px-[14px] text-[15px] font-semibold text-white ${focusRing}`}
        >
          {t('header.signup')}
        </Link>
      </nav>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate text-[15px] font-semibold">
        {t('header.greeting', { name: me.data.display_name })}
      </span>
      <button
        type="button"
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
        aria-busy={logout.isPending}
        className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full border-[1.5px] border-[#D6D3D1] bg-white px-[14px] text-[15px] font-semibold disabled:opacity-60 ${focusRing}`}
      >
        {t('header.logout')}
      </button>
    </div>
  );
}
