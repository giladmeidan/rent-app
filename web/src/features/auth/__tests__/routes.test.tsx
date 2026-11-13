import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { AppRoutes } from '../../../app/routes';
import he from '../../../locales/he.json';
import { clearInviteToken } from '../../flatmates/inviteToken';
import type { UserOut } from '../../../api/client';
import { gushDan, listing } from '../../listings/__tests__/fixtures';
import { page } from '../../search/__tests__/fixtures';
import { currentPath, json, mockApi, noa, renderRoutes } from './harness';

afterEach(() => {
  vi.unstubAllGlobals();
  clearInviteToken();
});

describe('routes', () => {
  it('ac9_redirects', async () => {
    // Logged in: /login and /signup send the person home, a seeker's being the search (0009a).
    for (const path of ['/login', '/signup?role=owner']) {
      mockApi({
        'GET /me': [json(noa)],
        'GET /areas': [json([])],
        'GET /listings': [() => json(page([]))],
        'GET /me/conversations': [() => json([])],
        'GET /me/likes': [() => json({ liked_me: [], mine: [] })],
      });
      const view = renderRoutes(path, <AppRoutes />);

      await vi.waitFor(() => {
        expect(currentPath()).toBe('/search');
      });
      expect(await screen.findByRole('heading', { level: 1, name: he.search.title })).toBeVisible();
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

    // Unknown path: home, the landing.
    renderRoutes('/no/such/page', <AppRoutes />);
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/');
    });
    // The title's line break (whitespace-pre-line) reads as a space.
    const landing = he.landing.title.replace('\n', ' ');
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: (name) => name.replace(/\s+/g, ' ') === landing,
      }),
    ).toBeVisible();
  });

  it('ac10_profile_for_any_account', async () => {
    // Spec 0010b: the profile is "a person looking", open to every account. A seeker and an owner
    // both reach it through AppRoutes.
    for (const me of [noa, { ...noa, role: 'owner' as const }]) {
      mockApi({
        'GET /me': [json(me)],
        'GET /me/profile': [json({ detail: 'seeker_profile_not_found' }, 404)],
        'GET /areas': [json([gushDan])],
        'GET /me/conversations': [json([])],
      });
      const view = renderRoutes('/me/profile', <AppRoutes />);
      expect(
        await screen.findByRole('heading', { level: 1, name: he.profile.title }),
      ).toBeVisible();
      expect(await screen.findByRole('button', { name: he.profile.save })).toBeVisible();
      expect(currentPath()).toBe('/me/profile');
      view.unmount();
      vi.unstubAllGlobals();
    }

    // A visitor lands on /login?next=<the page> and never requests the profile.
    const api = mockApi({
      'GET /me': [json({ detail: 'unauthenticated' }, 401)],
      'GET /areas': [json([])],
    });
    renderRoutes('/me/profile', <AppRoutes />);
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/login?next=%2Fme%2Fprofile');
    });
    expect(screen.queryByRole('heading', { level: 1, name: he.profile.title })).toBeNull();
    expect(api.calls('GET /me/profile')).toHaveLength(0);
  });

  it('ac10_market_routes_for_any_account', async () => {
    // Spec 0010b: every room page is for any account; apartments keep the roles.
    const room = listing({ listing_type: 'room', flatmates_count: 2 });
    const reached = async (me: UserOut, path: string, title: string | RegExp) => {
      mockApi({
        'GET /me': [json(me)],
        'GET /areas': [json([gushDan])],
        'GET /me/listings': [json([room])],
        'GET /me/likes': [json({ liked_me: [], mine: [] })],
        'GET /me/profile': [json({ detail: 'seeker_profile_not_found' }, 404)],
        'GET /me/conversations': [json([])],
        [`GET /listings/${room.id}/applications`]: [json([])],
        [`GET /listings/${room.id}/people`]: [json({ items: [], total: 0 })],
        [`GET /listings/${room.id}/flatmates`]: [json([])],
      });
      const view = renderRoutes(path, <AppRoutes />);
      expect(await screen.findByRole('heading', { level: 1, name: title }), path).toBeVisible();
      expect(currentPath()).toBe(path);
      view.unmount();
      vi.unstubAllGlobals();
    };
    const seeker = noa;
    const owner = { ...noa, role: 'owner' as const };
    for (const [path, title] of [
      ['/listings/new', he.listings.new.title],
      [`/me/listings/${room.id}/edit`, he.listings.edit.title],
      [`/me/listings/${room.id}/applicants`, new RegExp(`^${he.applicants.titleFor}`)],
      [`/me/listings/${room.id}/people`, he.people.title],
      [`/me/listings/${room.id}/flatmates`, he.flatmates.title],
      ['/me/likes', he.likes.title],
      ['/me/profile', he.profile.title],
    ] as const) {
      await reached(seeker, path, title);
    }
    await reached(owner, '/me/likes', he.likes.title);
    await reached(owner, '/me/profile', he.profile.title);

    // The apartments' own pages: a seeker on /me/listings and an owner on /me/applications go
    // home (`/`, then their side's home).
    for (const [me, path, home] of [
      [seeker, '/me/listings', '/search'],
      [owner, '/me/applications', '/me/listings'],
    ] as const) {
      const api = mockApi({
        'GET /me': [json(me)],
        'GET /me/listings': [json([])],
        'GET /me/conversations': [json([])],
        'GET /me/profile': [json({ detail: 'seeker_profile_not_found' }, 404)],
        'GET /listings': [() => json(page([]))],
      });
      const view = renderRoutes(path, <AppRoutes />);
      await vi.waitFor(() => {
        expect(currentPath()).toBe(home);
      });
      expect(api.calls('GET /me/applications')).toHaveLength(0);
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

  it('ac8_likes_for_any_account', async () => {
    // Spec 0010b: a seeker and an owner both reach the likes page through AppRoutes.
    for (const me of [noa, { ...noa, role: 'owner' as const }]) {
      mockApi({
        'GET /me': [json(me)],
        'GET /me/likes': [json({ liked_me: [], mine: [] })],
        'GET /me/conversations': [json([])],
      });
      const view = renderRoutes('/me/likes', <AppRoutes />);
      expect(await screen.findByRole('heading', { level: 1, name: he.likes.title })).toBeVisible();
      expect(currentPath()).toBe('/me/likes');
      view.unmount();
      vi.unstubAllGlobals();
    }

    // A visitor lands on /login and never requests the likes.
    const api = mockApi({
      'GET /me': [json({ detail: 'unauthenticated' }, 401)],
      'GET /areas': [json([])],
    });
    renderRoutes('/me/likes', <AppRoutes />);
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/login?next=%2Fme%2Flikes');
    });
    expect(screen.queryByRole('heading', { level: 1, name: he.likes.title })).toBeNull();
    expect(api.calls('GET /me/likes')).toHaveLength(0);
  });
});
