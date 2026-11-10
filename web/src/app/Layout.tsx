import { useTranslation } from 'react-i18next';
import { Link, Outlet } from 'react-router';

import { AuthMenu } from '../features/auth/AuthMenu';

/** The shell on every route: brand at the inline start, the auth menu at the inline end. */
export function Layout() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-[640px] px-4">
      <header className="pb-2 pt-[18px]">
        <div className="flex items-center justify-between gap-3">
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
                stroke="#FFFFFF"
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
          <AuthMenu />
        </div>
        <p className="mt-1 text-muted">{t('app.tagline')}</p>
      </header>
      <main className="pb-8 pt-6">
        <Outlet />
      </main>
    </div>
  );
}
