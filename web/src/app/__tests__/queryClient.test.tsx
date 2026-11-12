import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../locales/he.json';
import {
  currentPath,
  deferred,
  json,
  mockApi,
  renderRoutes,
} from '../../features/auth/__tests__/harness';
import { ME_KEY } from '../../features/auth/useMe';
import {
  clearInviteToken,
  readInviteToken,
  stashInviteToken,
} from '../../features/flatmates/inviteToken';
import { ApiError } from '../../features/listings/api';
import { listing, owner, seeker } from '../../features/listings/__tests__/fixtures';
import { profile } from '../../features/profile/__tests__/fixtures';
import { listingDetail } from '../../features/search/__tests__/fixtures';
import { createQueryClient } from '../queryClient';
import { AppRoutes } from '../routes';

afterEach(() => {
  vi.unstubAllGlobals();
  clearInviteToken();
});

const unauthenticated = () => json({ detail: 'unauthenticated' }, 401);

/** The per-user queries (`['me', …]`) still in the cache. */
const perUserQueries = (client: ReturnType<typeof createQueryClient>) =>
  client
    .getQueryCache()
    .findAll({ queryKey: ME_KEY })
    .filter((q) => q.queryKey.length > 1);

/** Waits until `route` was requested and every other request of the page has been answered. */
async function settled(api: ReturnType<typeof mockApi>, route: string) {
  await vi.waitFor(() => {
    expect(api.calls(route)).toHaveLength(1);
    expect(api.calls('GET /me/conversations').length).toBeGreaterThan(0);
  });
  await new Promise((r) => setTimeout(r, 20));
}

describe('createQueryClient', () => {
  it('ac1_query_401_ends_session', async () => {
    // An owner on a listing's applicants: the applicants answer 401 (once the header's own
    // requests have settled, so none is still on its way to the page).
    const L = listing();
    let client = createQueryClient({ retryDelay: 0 });
    let expired = deferred();
    let api = mockApi({
      'GET /me': [json(owner)],
      'GET /me/listings': [() => json([L])],
      [`GET /listings/${L.id}/applications`]: [expired.promise],
      'GET /me/conversations': [() => json([])],
    });
    let view = renderRoutes(`/me/listings/${L.id}/applicants`, <AppRoutes />, client);
    await settled(api, `GET /listings/${L.id}/applications`);
    expired.resolve(unauthenticated());
    await vi.waitFor(() => {
      expect(currentPath()).toBe(
        `/login?next=${encodeURIComponent(`/me/listings/${L.id}/applicants`)}`,
      );
    });
    expect(client.getQueryData(ME_KEY)).toBeNull();
    expect(perUserQueries(client)).toEqual([]);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.auth.login.title }),
    ).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();

    // A seeker on "my likes": the likes answer 401.
    client = createQueryClient({ retryDelay: 0 });
    expired = deferred();
    api = mockApi({
      'GET /me': [json(seeker)],
      'GET /me/likes': [expired.promise],
      'GET /me/profile': [() => json(profile())],
      'GET /me/conversations': [() => json([])],
    });
    view = renderRoutes('/me/likes', <AppRoutes />, client);
    await settled(api, 'GET /me/likes');
    expired.resolve(unauthenticated());
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/login?next=%2Fme%2Flikes');
    });
    expect(client.getQueryData(ME_KEY)).toBeNull();
    expect(perUserQueries(client)).toEqual([]);
    view.unmount();
    vi.unstubAllGlobals();

    // The join page with a stashed invite token: the preview answers 401. The token survives the
    // trip through login (its query's `meta`).
    client = createQueryClient({ retryDelay: 0 });
    stashInviteToken('Tk-secret_42');
    const join = mockApi({
      'GET /me': [json(seeker)],
      'POST /flatmate-invites/preview': [unauthenticated()],
      'GET /me/conversations': [() => json([])],
    });
    view = renderRoutes('/flatmates/join', <AppRoutes />, client);
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/login?next=%2Fflatmates%2Fjoin');
    });
    expect(join.calls('POST /flatmate-invites/preview')).toHaveLength(1);
    expect(client.getQueryData(ME_KEY)).toBeNull();
    expect(readInviteToken()).toBe('Tk-secret_42');
    view.unmount();
    vi.unstubAllGlobals();
    clearInviteToken();

    // A seeker on a listing page whose list and profile both answer 401 in one render: the session
    // clears once, so the listing (each GET counts a view) is reset and requested once more only.
    client = createQueryClient({ retryDelay: 0 });
    const mine = deferred();
    const own = deferred();
    api = mockApi({
      'GET /me': [json(seeker)],
      'GET /listings/A': [() => json(listingDetail({ id: 'A' }))],
      'GET /me/applications': [mine.promise],
      'GET /me/profile': [own.promise],
      'GET /me/conversations': [() => json([])],
    });
    view = renderRoutes('/listings/A', <AppRoutes />, client);
    await vi.waitFor(() => {
      expect(api.calls('GET /me/applications')).toHaveLength(1);
      expect(api.calls('GET /me/profile')).toHaveLength(1);
    });
    expect(api.calls('GET /listings/A')).toHaveLength(1);
    mine.resolve(unauthenticated());
    own.resolve(unauthenticated());
    // The logged-out state of the apply section: the login prompt.
    expect(await screen.findByText(he.applications.loginPrompt)).toBeVisible();
    expect(client.getQueryData(ME_KEY)).toBeNull();
    // Let any further reset land before counting.
    await new Promise((r) => setTimeout(r, 50));
    expect(api.calls('GET /listings/A').length).toBeLessThanOrEqual(2);
    expect(currentPath()).toBe('/listings/A');
  });

  it('ac2_no_retry_on_4xx', async () => {
    const cases: [string, () => Promise<never>, number][] = [
      ['404', () => Promise.reject(new ApiError('GET', '/x', 404, { detail: 'not_found' })), 1],
      ['409', () => Promise.reject(new ApiError('GET', '/x', 409, { detail: 'conflict' })), 1],
      ['500', () => Promise.reject(new ApiError('GET', '/x', 500, null)), 2],
      ['network', () => Promise.reject(new TypeError('Failed to fetch')), 2],
    ];
    for (const [name, fail, calls] of cases) {
      const client = createQueryClient({ retryDelay: 0 });
      const queryFn = vi.fn(fail);
      function Probe() {
        const query = useQuery({ queryKey: ['probe', name], queryFn });
        return <p>{query.status}</p>;
      }
      const view = render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
      expect(await screen.findByText('error')).toBeVisible();
      expect(queryFn).toHaveBeenCalledTimes(calls);
      view.unmount();
    }
  });
});
