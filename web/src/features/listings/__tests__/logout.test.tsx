import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { writeDraft } from '../../../app/drafts';
import he from '../../../locales/he.json';
import { useMyApplications } from '../../applications/useMyApplications';
import {
  empty,
  json,
  mockApi,
  noa,
  renderRoutes,
  testQueryClient,
} from '../../auth/__tests__/harness';
import { AuthMenu } from '../../auth/AuthMenu';
import type { ListingOut } from '../api';
import { markSeen, readSeen } from '../seen';
import { MY_LISTINGS_KEY } from '../useMyListings';
import { listing, owner } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/** A seeker call whose 401 runs `clearSession`. */
function SeekerCall() {
  useMyApplications();
  return null;
}

describe('AuthMenu for an owner', () => {
  it('header_link_and_logout_drops_my_listings', async () => {
    mockApi({ 'GET /me': [json(owner)], 'POST /auth/logout': [empty(204)] });
    const client = testQueryClient();
    client.setQueryData<ListingOut[]>(MY_LISTINGS_KEY, [listing()]);
    renderRoutes('/', <AuthMenu />, client);

    const link = await screen.findByRole('link', { name: he.header.myListings });
    expect(link).toHaveAttribute('href', '/me/listings');

    // The next person on this device must not see this owner's listings from the cache.
    fireEvent.click(screen.getByRole('button', { name: he.header.logout }));
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    expect(client.getQueryData(MY_LISTINGS_KEY)).toBeUndefined();
    // Mutations (and the bodies they sent) are forgotten too.
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    expect(screen.queryByRole('link', { name: he.header.myListings })).toBeNull();
  });

  it('ac7_logout_clears_drafts', async () => {
    // Drafts of this person and of another one, and other tab storage.
    writeDraft('apply', 'L', owner.id, 'apply text');
    writeDraft('chat', 'C', owner.id, 'chat text');
    writeDraft('chat', 'D', 'someone-else', 'other text');
    window.sessionStorage.setItem('unrelated', 'kept');
    mockApi({ 'GET /me': [json(owner)], 'POST /auth/logout': [empty(204)] });
    renderRoutes('/', <AuthMenu />, testQueryClient());

    fireEvent.click(await screen.findByRole('button', { name: he.header.logout }));
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    const keys = Array.from({ length: window.sessionStorage.length }, (_, i) =>
      window.sessionStorage.key(i),
    );
    expect(keys.filter((k) => k?.startsWith('rent-app:draft:'))).toEqual([]);
    expect(window.sessionStorage.getItem('unrelated')).toBe('kept');
  });

  it('ac9_logout_clears_seen_not_401', async () => {
    // An explicit logout forgets the listings opened on this device.
    markSeen('L1');
    markSeen('L2');
    mockApi({ 'GET /me': [json(owner)], 'POST /auth/logout': [empty(204)] });
    let view = renderRoutes('/', <AuthMenu />, testQueryClient());
    fireEvent.click(await screen.findByRole('button', { name: he.header.logout }));
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    expect(readSeen()).toEqual(new Set());
    view.unmount();
    vi.unstubAllGlobals();

    // A seeker call answering 401 (`clearSession`): the person is forgotten, the seen ids remain.
    markSeen('L1');
    markSeen('L2');
    const api = mockApi({
      'GET /me': [json(noa)],
      'GET /me/applications': [json({ detail: 'unauthenticated' }, 401)],
    });
    view = renderRoutes(
      '/',
      <>
        <AuthMenu />
        <SeekerCall />
      </>,
      testQueryClient(),
    );
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    expect(api.calls('GET /me/applications').length).toBeGreaterThan(0);
    expect(api.calls('POST /auth/logout')).toHaveLength(0);
    expect(readSeen()).toEqual(new Set(['L1', 'L2']));
    view.unmount();
  });
});
