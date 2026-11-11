import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { AppRoutes } from '../../../app/routes';
import he from '../../../locales/he.json';
import { clearInviteToken } from '../../flatmates/inviteToken';
import { gushDan } from '../../listings/__tests__/fixtures';
import { currentPath, json, mockApi, noa, renderRoutes } from './harness';

afterEach(() => {
  vi.unstubAllGlobals();
  clearInviteToken();
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

    // An owner lands on /, a visitor on /login?next=<the page>; neither requests the profile.
    for (const [me, path] of [
      [json({ ...noa, role: 'owner' }), '/'],
      [json({ detail: 'unauthenticated' }, 401), '/login?next=%2Fme%2Fprofile'],
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
  it('ac4_guards_keep_next', async () => {
    // A logged-out visit to a guarded page keeps its path and query in `next`, never the hash.
    for (const [path, target] of [
      ['/me/listings?x=1', '/login?next=%2Fme%2Flistings%3Fx%3D1'], // RequireOwner
      ['/me/listings?x=1#secret', '/login?next=%2Fme%2Flistings%3Fx%3D1'],
      ['/me/applications', '/login?next=%2Fme%2Fapplications'], // RequireSeeker
      ['/chat?a=b&c=d', '/login?next=%2Fchat%3Fa%3Db%26c%3Dd'], // RequireUser
      // The public join page runs its own check: a bare `next`, the token never in it (A1).
      ['/flatmates/join#secret', '/login?next=%2Fflatmates%2Fjoin'],
    ] as const) {
      const api = mockApi({
        'GET /me': [json({ detail: 'unauthenticated' }, 401)],
        'GET /areas': [json([])],
      });
      const view = renderRoutes(path, <AppRoutes />);
      await vi.waitFor(() => {
        expect(currentPath()).toBe(target);
      });
      expect(currentPath()).not.toContain('secret');
      expect(
        await screen.findByRole('heading', { level: 1, name: he.auth.login.title }),
      ).toBeVisible();
      expect(api.calls('GET /me/listings')).toHaveLength(0);
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
});
