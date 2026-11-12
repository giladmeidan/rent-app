import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../locales/he.json';
import { application } from '../../features/applications/__tests__/fixtures';
import { deferred, json, mockApi, renderRoutes } from '../../features/auth/__tests__/harness';
import { thread } from '../../features/chat/__tests__/fixtures';
import { gushDan, seeker } from '../../features/listings/__tests__/fixtures';
import i18n from '../i18n';
import { AppRoutes } from '../routes';
import { usePageTitle } from '../usePageTitle';

afterEach(() => {
  vi.unstubAllGlobals();
  document.title = he.app.title;
});

const titled = (page: string) => i18n.t('app.pageTitle', { page, app: he.app.title });

const router: { navigate: NavigateFunction } = { navigate: () => undefined };
function NavigateProbe() {
  const navigate = useNavigate();
  useEffect(() => {
    router.navigate = navigate;
  }, [navigate]);
  return null;
}

function Titled({ page }: { page: string | undefined }) {
  usePageTitle(page);
  return null;
}

describe('usePageTitle', () => {
  it('ac3_page_titles', async () => {
    // The hook alone: "{page} · {app}", the app alone for `undefined`, and the app on unmount.
    document.title = 'stale';
    const hook = render(<Titled page="Page" />);
    expect(document.title).toBe(`Page · ${he.app.title}`);
    hook.rerender(<Titled page={undefined} />);
    expect(document.title).toBe(he.app.title);
    hook.rerender(<Titled page="Page" />);
    hook.unmount();
    expect(document.title).toBe(he.app.title);

    // Through the routes: /me/applications, then a chat thread, then `/` (which sets no title).
    const room = thread();
    const listing = deferred();
    const missing = crypto.randomUUID();
    mockApi({
      'GET /me': [() => json(seeker)],
      'GET /areas': [() => json([gushDan])],
      'GET /me/applications': [() => json([application()])],
      'GET /me/conversations': [() => json([])],
      'GET /me/likes': [() => json({ liked_me: [], mine: [] })],
      'GET /me/flats': [() => json([])],
      'GET /me/profile': [() => json({ detail: 'seeker_profile_not_found' }, 404)],
      [`GET /conversations/${room.id}`]: [() => json(room)],
      [`GET /listings/${missing}`]: [listing.promise],
    });
    renderRoutes(
      '/me/applications',
      <>
        <AppRoutes />
        <NavigateProbe />
      </>,
    );
    await screen.findByRole('heading', { level: 1, name: he.applications.mine.title });
    expect(document.title).toBe(titled(he.applications.mine.title));

    await act(async () => {
      await router.navigate(`/chat/${room.id}`);
    });
    await screen.findByRole('heading', { level: 1, name: room.other_name });
    expect(document.title).toBe(titled(room.other_name));

    // A listing: the app alone while it loads, then the not-found heading.
    await act(async () => {
      await router.navigate(`/listings/${missing}`);
    });
    expect(document.title).toBe(he.app.title);
    listing.resolve(json({ detail: 'listing_not_found' }, 404));
    await screen.findByRole('heading', { level: 1, name: he.listing.notFound });
    expect(document.title).toBe(titled(he.listing.notFound));

    // Back on /me/applications, then `/`: the app's name, never the last page's title.
    await act(async () => {
      await router.navigate('/me/applications');
    });
    await waitFor(() => {
      expect(document.title).toBe(titled(he.applications.mine.title));
    });
    await act(async () => {
      await router.navigate('/');
    });
    await screen.findByRole('heading', { name: he.areas.heading });
    expect(document.title).toBe(he.app.title);
  });
});
