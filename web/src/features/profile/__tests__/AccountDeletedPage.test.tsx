import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from '../../../app/routes';
import he from '../../../locales/he.json';
import { json, mockApi, renderRoutes } from '../../auth/__tests__/harness';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AccountDeletedPage', () => {
  it('ac9_account_deleted_page', async () => {
    // Reachable signed out, and a reload shows the same page: nothing but `GET /me` is asked.
    const api = mockApi({ 'GET /me': [() => json({ detail: 'unauthenticated' }, 401)] });
    renderRoutes('/account-deleted', <AppRoutes />);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.accountDeleted.title }),
    ).toBeVisible();
    expect(screen.getByText(he.accountDeleted.body)).toBeVisible();
    expect(screen.getByRole('link', { name: he.accountDeleted.home })).toHaveAttribute('href', '/');
    expect(document.title).toContain(he.accountDeleted.title);
    expect(api.fetchMock.mock.calls.map(([r]) => `${r.method} ${new URL(r.url).pathname}`)).toEqual(
      ['GET /me'],
    );
  });
});
