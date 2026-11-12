import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router';

import { AuthMenu } from '../features/auth/AuthMenu';
import { ChatStreamProvider } from '../features/chat/ChatStreamProvider';

/**
 * The shell on every route: brand and the search link at the inline start, the auth menu at the
 * inline end; the row wraps on a narrow screen. The chat event stream (one per tab) wraps both the
 * header (its chat count) and the page.
 */
export function Layout() {
  const { t } = useTranslation();
  return (
    <ChatStreamProvider>
      <div className="mx-auto max-w-[640px] px-4">
        <header className="pb-2 pt-[18px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              to="/"
              className="flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent">
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  className="text-on-ink"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 11l9-8 9 8" />
                  <path d="M5 10v10h14V10" />
                </svg>
              </span>
              <span className="text-xl font-extrabold">{t('app.title')}</span>
            </Link>
            <NavLink
              to="/search"
              className="inline-flex min-h-[44px] shrink-0 items-center rounded-full px-[10px] text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-[current=page]:text-accent-strong aria-[current=page]:underline aria-[current=page]:underline-offset-4"
            >
              {t('header.search')}
            </NavLink>
            <div className="ms-auto flex min-w-0 items-center">
              <AuthMenu />
            </div>
          </div>
          <p className="mt-1 text-ink-muted">{t('app.tagline')}</p>
        </header>
        <main className="pb-8 pt-6">
          <Outlet />
        </main>
      </div>
    </ChatStreamProvider>
  );
}
