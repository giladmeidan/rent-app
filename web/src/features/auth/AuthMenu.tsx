import { useTranslation } from 'react-i18next';
import { Link, matchPath, useLocation } from 'react-router';

import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { focusRing } from '../../components/focusRing';
import { NavIcon, NavTab } from '../../components/NavTab';
import { Skeleton } from '../../components/Skeleton';
import { useSide } from '../../app/side';
import { ChatNavLink } from '../chat/ChatNavLink';
import { MarketMineNavLink } from '../likes/MarketMineNavLink';
import { useLogout } from './useLogout';
import { useMe } from './useMe';

/**
 * Routes with their own bottom UI (the wizard's action bar, the listing's apply bar, the chat
 * composer): below `lg` the tab bar is hidden there; from `lg` it stays in the top bar.
 */
export const FOCUSED_ROUTES = [
  '/listings/new',
  '/me/listings/:id/edit',
  '/listings/:id',
  '/chat/:id',
] as const;

const headerLink = cx(
  'inline-flex min-h-tap shrink-0 items-center rounded-md px-3 text-label text-ink hover:text-accent aria-[current=page]:text-accent',
  focusRing,
);

const searchIcon = (
  <NavIcon>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </NavIcon>
);

const houseIcon = (
  <NavIcon>
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h14V10" />
  </NavIcon>
);

const likesIcon = (
  <NavIcon>
    <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />
  </NavIcon>
);

const profileIcon = (
  <NavIcon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </NavIcon>
);

/**
 * The header's inline end: who is logged in, or the login link. Never blocks the shell.
 * - Anonymous: one named `<nav>` with "כניסה" (the side switch, spec 0010a, leads to the search).
 *   On the market side it returns to `/market` (spec 0010b), so a new email that signs up through
 *   login is not asked owner or seeker (`OtpForm`).
 * - Signed in: one named `<nav data-bottom-nav>` with the tabs of the current side (a bottom tab
 *   bar below `lg`, the top bar's text tabs from `lg`; MARKET-PLAN section 7), then the greeting
 *   and logout outside it. Both sides share one tab order; only the routes differ, and the
 *   apartments' "הפעילות שלי" follows the role (an owner's listings, a seeker's applications).
 */
export function AuthMenu() {
  const { t } = useTranslation();
  const me = useMe();
  const logout = useLogout();
  const { pathname } = useLocation();
  const side = useSide();

  // Data wins: a failed background refetch keeps the cached person (TanStack Query v5 sets
  // `isError` beside `data`), so a signed-in tab bar never flips to the anonymous nav.
  const user = me.data;

  if (user === undefined && me.isPending) {
    return (
      <div className="me-auto flex min-h-tap items-center" aria-busy="true">
        <Skeleton className="h-5 w-24" />
      </div>
    );
  }

  // 401, or a network or server error on /me with nothing cached, renders the logged-out state.
  if (user === undefined || user === null) {
    return (
      <nav aria-label={t('nav.label')} className="me-auto flex items-center gap-1">
        <Link
          to={side === 'market' ? `/login?next=${encodeURIComponent('/market')}` : '/login'}
          className={headerLink}
        >
          {t('header.login')}
        </Link>
      </nav>
    );
  }

  const focused = FOCUSED_ROUTES.some((pattern) => matchPath(pattern, pathname) !== null);
  // One skeleton on both sides: חיפוש · (לייקים, market only) · הפעילות שלי · צ'אט · פרופיל.
  // Posting lives inside הפעילות שלי (the my-listings "new" button).
  const market = side === 'market';
  // The market's tab is `MarketMineNavLink` (it carries the invite count).
  const mineTo = user.role === 'owner' ? '/me/listings' : '/me/applications';
  const tabs = (
    <>
      <NavTab
        to={market ? '/market' : '/search'}
        end={market}
        icon={searchIcon}
        label={t('nav.search')}
      />
      {market && <NavTab to="/me/likes" icon={likesIcon} label={t('header.likes')} />}
      {market ? (
        <MarketMineNavLink />
      ) : (
        <NavTab to={mineTo} icon={houseIcon} label={t('nav.mine')} />
      )}
      <ChatNavLink />
      <NavTab to="/me/profile" icon={profileIcon} label={t('nav.profile')} />
    </>
  );

  return (
    <>
      <nav
        aria-label={t('nav.label')}
        data-bottom-nav=""
        data-hidden-mobile={focused ? '' : undefined}
        className={cx(
          // Below lg: the bottom tab bar, above MapLibre's controls (2), below the skip link (50).
          // Its block size and safe-area padding are index.css's, from --bottom-nav-h.
          'flex max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-30 max-lg:border-t max-lg:border-border max-lg:bg-surface',
          // From lg: the top bar's text tabs, after the brand.
          'lg:order-1 lg:me-auto lg:gap-1',
          focused && 'max-lg:hidden',
        )}
      >
        {tabs}
      </nav>
      <div className="flex min-w-0 flex-row-reverse items-center gap-3 max-lg:me-auto lg:order-last">
        <span className="truncate text-label max-sm:hidden">
          {t('header.greeting', { name: user.display_name })}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          aria-busy={logout.isPending}
          className="shrink-0"
        >
          {t('header.logout')}
        </Button>
      </div>
    </>
  );
}
