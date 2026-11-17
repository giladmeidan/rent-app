import * as Sentry from '@sentry/react';
import type { Breadcrumb, ErrorEvent } from '@sentry/react';
import type { ReactNode } from 'react';

import { ErrorState } from '../components/ErrorState';
import { PageContainer } from '../components/PageContainer';
import { routePattern } from './routePattern';

// Sentry error reports from the browser (spec 0019a): off without VITE_SENTRY_DSN, and nothing
// personal in what is sent (no user, headers, query, hash or emails; the URL is the route pattern).

const EMAIL = /[^\s@"'<>()[\]{},;:]+@[^\s@"'<>()[\]{},;:]+\.[^\s@"'<>()[\]{},;:]+/g;
const redact = (text: string | undefined) => text?.replace(EMAIL, '[email]');
const withoutQuery = (url: unknown) => (typeof url === 'string' ? url.split(/[?#]/)[0] : url);

function pathOf(url: string | undefined): string {
  try {
    return new URL(url ?? window.location.href, window.location.origin).pathname;
  } catch {
    return '/';
  }
}

export function beforeSend(event: ErrorEvent): ErrorEvent {
  // httpContextIntegration adds the full URL and the Referer / User-Agent headers.
  event.request = { url: routePattern(pathOf(event.request?.url)) };
  delete event.user;
  delete event.extra;
  if (event.message !== undefined) event.message = redact(event.message);
  for (const exception of event.exception?.values ?? []) {
    exception.value = redact(exception.value);
  }
  for (const crumb of event.breadcrumbs ?? []) crumb.message = redact(crumb.message);
  return event;
}

export function beforeBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  // Console lines, and `ui.*` crumbs: a click's element string carries aria-label / title / alt,
  // which hold names ("דיווח על <name>").
  if (crumb.category === 'console' || crumb.category?.startsWith('ui.')) return null;
  const data = crumb.data;
  if (data !== undefined) {
    // Search filters and the flatmates invite token live in the query and hash.
    if (crumb.category === 'fetch' || crumb.category === 'xhr') data.url = withoutQuery(data.url);
    if (crumb.category === 'navigation') {
      data.from = withoutQuery(data.from);
      data.to = withoutQuery(data.to);
    }
  }
  if (crumb.message !== undefined) crumb.message = redact(crumb.message);
  return crumb;
}

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || undefined,
    // SDK 11's replacement for `sendDefaultPii: false` (removed; its defaults collect all of these).
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 0,
    beforeSend,
    beforeBreadcrumb,
  });
}

/** The root error fallback: the kit's page error, whose retry reloads the page. */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary
      fallback={
        <main id="main" tabIndex={-1} className="pb-8 pt-6 focus:outline-none">
          <PageContainer>
            <ErrorState page onRetry={() => window.location.reload()} />
          </PageContainer>
        </main>
      }
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}
