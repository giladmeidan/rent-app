import { QueryCache, QueryClient } from '@tanstack/react-query';

import { hasStatus } from '../features/applications/api';
import { clearSession } from '../features/auth/useLogout';
import { ME_KEY } from '../features/auth/useMe';
import { ApiError } from '../features/listings/api';

/**
 * The app's query client (spec 0009g).
 *
 * - A **query** answering 401 ends the session: the API sends 401 only for "no or expired
 *   session", so `clearSession` runs and the route guards send the person to
 *   `/login?next=<this page>`. A burst of 401s clears once (`['me']` is already `null`), so the
 *   search and listing queries are reset once (each `GET /listings/{id}` counts a view). A query
 *   with `meta: { keepInviteTokenOn401: true }` (the join page's preview) keeps the stashed invite
 *   token. `useMe`'s own 401 is `null`, not an error, and mutations keep their own 401 handling.
 * - One retry, for network errors and 5xx only: a 4xx is the answer, and its page state shows at
 *   once. `retryDelay` is for tests (0); the default is TanStack's.
 * - `networkMode: 'always'`: offline, a request fails at once and the error line says so (0009f
 *   Q9), instead of pausing until the network returns.
 */
export function createQueryClient(overrides: { retryDelay?: number } = {}): QueryClient {
  const queryCache = new QueryCache();
  const client: QueryClient = new QueryClient({
    queryCache,
    defaultOptions: {
      queries: {
        retry: (failureCount, error) =>
          failureCount < 1 &&
          !(error instanceof ApiError && error.status >= 400 && error.status < 500),
        ...(overrides.retryDelay === undefined ? {} : { retryDelay: overrides.retryDelay }),
        networkMode: 'always',
      },
      mutations: { networkMode: 'always' },
    },
  });
  // A query's final error, seen inside the dispatch that records it (not the cache's `onError`,
  // which runs after that dispatch has scheduled the page's re-render): the cleared `['me']` then
  // reaches the route guard in the same React render as the page's error, so the guard unmounts
  // the page before it can re-create the per-user queries `clearSession` just removed.
  queryCache.subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'error') return;
    if (!hasStatus(event.action.error, 401)) return;
    // Already logged out: the session was cleared by an earlier 401 of this burst.
    if (client.getQueryData(ME_KEY) === null) return;
    clearSession(client, { keepInviteToken: event.query.meta?.keepInviteTokenOn401 === true });
  });
  return client;
}
