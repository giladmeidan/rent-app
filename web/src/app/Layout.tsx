import { Link, Outlet } from 'react-router';

import { focusRing } from '../components/focusRing';
import { Logo } from '../components/Logo';
import { PageContainer } from '../components/PageContainer';
import { SkipLink } from '../components/SkipLink';
import { AuthMenu } from '../features/auth/AuthMenu';
import { ChatStreamProvider } from '../features/chat/ChatStreamProvider';
import { RouteFocus } from './RouteFocus';

/**
 * The shell on every route: one header row (the homie lockup at the inline start, the auth menu
 * and, from `lg`, a signed-in person's nav, then the inline end), on `surface` with a bottom border
 * (InboxDesktop.dc.html). Nothing here takes `transform`, `filter` or `backdrop-filter`: the tab bar
 * below `lg` is `position: fixed` to the viewport. The chat event stream (one per tab) wraps both
 * the header (its chat count) and the page.
 */
export function Layout() {
  return (
    <ChatStreamProvider>
      <SkipLink />
      <RouteFocus />
      <header className="border-b border-border bg-surface">
        <PageContainer width="wide">
          <div className="flex min-h-16 flex-nowrap items-center gap-x-3 py-2">
            {/* The lockup's alt (app.title, "הומי") names the link. */}
            <Link
              to="/"
              className={`flex min-h-tap shrink-0 items-center rounded-md px-1 ${focusRing}`}
            >
              <Logo variant="lockup" className="h-8" />
            </Link>
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
