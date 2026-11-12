import { useTranslation } from 'react-i18next';
import { Link, matchPath, NavLink, useLocation } from 'react-router';

import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { focusRing } from '../../components/focusRing';
import { NavIcon, NavTab } from '../../components/NavTab';
import { Skeleton } from '../../components/Skeleton';
import { ChatNavLink } from '../chat/ChatNavLink';
import { LikesNavLink } from '../likes/LikesNavLink';
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

/**
 * The header's inline end: who is logged in, or the login link. Never blocks the shell.
 * - Anonymous: one named `<nav>` with "חיפוש דירות" (not on `/`, whose seeker CTA is the same link)
 *   and "כניסה".
 * - Signed in: one named `<nav data-bottom-nav>` with the role's tabs (a bottom tab bar below
 *   `lg`, the top bar's text tabs from `lg`), then the greeting and logout outside it.
 */
export function AuthMenu() {
  const { t } = useTranslation();
  const me = useMe();
  const logout = useLogout();
  const { pathname } = useLocation();

  // Data wins: a failed background refetch keeps the cached person (TanStack Query v5 sets
  // `isError` beside `data`), so a signed-in tab bar never flips to the anonymous nav.
  const user = me.data;

  if (user === undefined && me.isPending) {
    return (
      <div className="ms-auto flex min-h-tap items-center" aria-busy="true">
        <Skeleton className="h-5 w-24" />
      </div>
    );
  }

  // 401, or a network or server error on /me with nothing cached, renders the logged-out state.
  if (user === undefined || user === null) {
    return (
      <nav aria-label={t('nav.label')} className="ms-auto flex items-center gap-1">
        {pathname !== '/' && (
          <NavLink to="/search" className={headerLink}>
            {t('header.search')}
          </NavLink>
        )}
        <Link to="/login" className={headerLink}>
          {t('header.login')}
        </Link>
      </nav>
    );
  }

  const focused = FOCUSED_ROUTES.some((pattern) => matchPath(pattern, pathname) !== null);

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
          'lg:gap-1',
          focused && 'max-lg:hidden',
        )}
      >
        {user.role === 'owner' ? (
          <>
            <NavTab
              to="/me/listings"
              icon={
                <NavIcon>
                  <path d="M3 11l9-8 9 8" />
                  <path d="M5 10v10h14V10" />
                </NavIcon>
              }
              label={t('header.myListings')}
            />
            <ChatNavLink />
            <NavTab to="/search" icon={searchIcon} label={t('nav.search')} />
          </>
        ) : (
          <>
            <NavTab to="/search" icon={searchIcon} label={t('nav.search')} />
            <LikesNavLink />
            <NavTab
              to="/me/applications"
              icon={
                <NavIcon>
                  <path d="M4 5h16v14H4z" />
                  <path d="M4 9h16" />
                  <path d="M8 13h5" />
                </NavIcon>
              }
              label={t('nav.applications')}
            />
            <ChatNavLink />
            <NavTab
              to="/me/profile"
              icon={
                <NavIcon>
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21a8 8 0 0 1 16 0" />
                </NavIcon>
              }
              label={t('nav.profile')}
            />
          </>
        )}
      </nav>
      <div className="ms-auto flex min-w-0 items-center gap-3">
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
