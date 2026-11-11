import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { AppRoutes } from '../../../app/routes';
import he from '../../../locales/he.json';
import { gushDan } from '../../listings/__tests__/fixtures';
import { currentPath, json, mockApi, noa, renderRoutes } from './harness';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('routes', () => {
  it('ac9_redirects', async () => {
    // Logged in: /login and /signup send the person home.
    for (const path of ['/login', '/signup?role=owner']) {
      mockApi({ 'GET /me': [json(noa)], 'GET /areas': [json([])] });
      const view = renderRoutes(path, <AppRoutes />);

      await vi.waitFor(() => {
        expect(currentPath()).toBe('/');
      });
      expect(await screen.findByRole('heading', { name: he.areas.heading })).toBeVisible();
      expect(screen.getByText(i18n.t('header.greeting', { name: noa.display_name }))).toBeVisible();
      expect(screen.queryByLabelText(he.auth.email.label)).toBeNull();
      view.unmount();
      vi.unstubAllGlobals();
    }

    // Logged out: the pages render.
    mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)], 'GET /areas': [json([])] });
    const login = renderRoutes('/login', <AppRoutes />);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.auth.login.title }),
    ).toBeVisible();
    expect(currentPath()).toBe('/login');
    login.unmount();

    // Unknown path: home.
    renderRoutes('/no/such/page', <AppRoutes />);
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/');
    });
    expect(await screen.findByRole('heading', { name: he.areas.heading })).toBeVisible();
  });

  it('ac10_profile_is_seeker_only', async () => {
    // A seeker: the profile page renders through AppRoutes.
    let api = mockApi({
      'GET /me': [json(noa)],
      'GET /me/profile': [json({ detail: 'seeker_profile_not_found' }, 404)],
      'GET /areas': [json([gushDan])],
    });
    let view = renderRoutes('/me/profile', <AppRoutes />);
    expect(await screen.findByRole('heading', { level: 1, name: he.profile.title })).toBeVisible();
    expect(await screen.findByRole('button', { name: he.profile.save })).toBeVisible();
    expect(currentPath()).toBe('/me/profile');
    view.unmount();
    vi.unstubAllGlobals();

    // An owner lands on /, a visitor on /login; neither requests the profile.
    for (const [me, path] of [
      [json({ ...noa, role: 'owner' }), '/'],
      [json({ detail: 'unauthenticated' }, 401), '/login'],
    ] as const) {
      api = mockApi({ 'GET /me': [me], 'GET /areas': [json([])] });
      view = renderRoutes('/me/profile', <AppRoutes />);
      await vi.waitFor(() => {
        expect(currentPath()).toBe(path);
      });
      expect(screen.queryByRole('heading', { level: 1, name: he.profile.title })).toBeNull();
      expect(api.calls('GET /me/profile')).toHaveLength(0);
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
});
