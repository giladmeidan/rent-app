import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { empty, json, mockApi, renderRoutes, testQueryClient } from '../../auth/__tests__/harness';
import { AuthMenu } from '../../auth/AuthMenu';
import type { ListingOut } from '../api';
import { MY_LISTINGS_KEY } from '../useMyListings';
import { listing, owner } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

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
    expect(screen.queryByRole('link', { name: he.header.myListings })).toBeNull();
  });
});
