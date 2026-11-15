import { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router';

import { focusRing } from '../components/focusRing';
import { Logo } from '../components/Logo';
import { PageContainer } from '../components/PageContainer';
import { SkipLink } from '../components/SkipLink';
import { AuthMenu } from '../features/auth/AuthMenu';
import { ChatStreamProvider } from '../features/chat/ChatStreamProvider';
import { RouteFocus } from './RouteFocus';
import { setSide, sideOf } from './side';
import { SideSwitch } from './SideSwitch';

/**
 * The shell on every route: one header row (the homie lockup at the inline start, the side switch
 * (spec 0010a), then from `lg` the signed-in nav, then the auth menu at the inline end), on
 * `surface` with a bottom border (InboxDesktop.dc.html). Below `md` the switch takes a second row of
 * its own (`data-side-switch-row`): the lockup and logout already fill a phone's width. A side
 * page records its side, so shared pages (a listing, chat) keep the last one. Nothing here takes `transform`, `filter` or `backdrop-filter`: the tab bar
 * below `lg` is `position: fixed` to the viewport. The chat event stream (one per tab) wraps both
 * the header (its chat count) and the page.
 */
export function Layout() {
  const { pathname } = useLocation();
  useEffect(() => {
    const side = sideOf(pathname);
    if (side) setSide(side);
  }, [pathname]);

  return (
    <ChatStreamProvider>
      <SkipLink />
      <RouteFocus />
      <header className="border-b border-border bg-surface">
        <PageContainer width="wide">
          <div className="flex min-h-16 flex-row-reverse flex-wrap items-center gap-x-3 gap-y-2 py-2 md:flex-nowrap">
            {/* The lockup's alt (app.title, "Homie") names the link. */}
            <Link
              to="/"
              className={`flex min-h-tap shrink-0 items-center rounded-md px-1 ${focusRing}`}
            >
              <Logo variant="lockup" lang="en" className="h-8" />
            </Link>
            <div data-side-switch-row="" className="order-last w-full md:w-auto">
              <SideSwitch />
            </div>
            <AuthMenu />
          </div>
        </PageContainer>
      </header>
      <main id="main" tabIndex={-1} className="pb-8 pt-6 focus:outline-none">
        <Outlet />
      </main>
    </ChatStreamProvider>
  );
}
