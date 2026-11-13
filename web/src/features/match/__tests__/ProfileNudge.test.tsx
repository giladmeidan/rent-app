import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { json, mockApi, noa, renderRoutes } from '../../auth/__tests__/harness';
import { ListingPage } from '../../listings/ListingPage';
import { owner } from '../../listings/__tests__/fixtures';
import { personalOnlyProfile, profile } from '../../profile/__tests__/fixtures';
import { listingDetail } from '../../search/__tests__/fixtures';
import { ProfileNudge } from '../ProfileNudge';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.removeItem('homie.side');
});

const PROFILE = 'GET /me/profile';
const noProfile = () => json({ detail: 'seeker_profile_not_found' }, 404);
const routes = (
  <Routes>
    <Route path="/market" element={<ProfileNudge />} />
    <Route path="/search" element={<ProfileNudge />} />
    <Route path="/listings/:id" element={<ListingPage />} />
  </Routes>
);

/** Waits until the profile request settled, or until `/me` has, when it is never sent. */
async function settle(api: ReturnType<typeof mockApi>, requested: boolean) {
  await vi.waitFor(() => {
    expect(api.calls(requested ? PROFILE : 'GET /me')).toHaveLength(1);
  });
  await new Promise((r) => setTimeout(r, 20));
}

describe('ProfileNudge', () => {
  it('ac17_nudge_by_side', async () => {
    // Spec 0010b: on the market any signed-in account without a profile is nudged; on the
    // apartments side only a seeker is (an owner neither sees it nor requests the profile there).
    for (const [me, path, shown] of [
      [owner, '/market', true],
      [noa, '/market', true],
      [noa, '/search', true],
      [owner, '/search', false],
    ] as const) {
      const api = mockApi({ 'GET /me': [json(me)], [PROFILE]: [noProfile()] });
      const view = renderRoutes(path, routes);
      await settle(api, shown);
      expect(screen.queryByText(he.match.nudge) !== null, `${me.role} ${path}`).toBe(shown);
      expect(api.calls(PROFILE)).toHaveLength(shown ? 1 : 0);
      view.unmount();
      vi.unstubAllGlobals();
    }

    // A profile, or a visitor: no nudge.
    let api = mockApi({ 'GET /me': [json(owner)], [PROFILE]: [json(profile())] });
    let view = renderRoutes('/market', routes);
    await settle(api, true);
    expect(screen.queryByText(he.match.nudge)).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();
    api = mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)] });
    view = renderRoutes('/market', routes);
    await settle(api, false);
    expect(screen.queryByText(he.match.nudge)).toBeNull();
    expect(api.calls(PROFILE)).toHaveLength(0);
    view.unmount();
    vi.unstubAllGlobals();

    // On a listing page an owner with a match (they have a profile) requests it too, to word the
    // match card.
    const listing = listingDetail({
      id: 'A',
      match: { score: 80, agrees: ['budget'], differs: null },
    });
    api = mockApi({
      'GET /me': [json(owner)],
      'GET /listings/A': [json(listing)],
      [PROFILE]: [json(profile())],
    });
    renderRoutes('/listings/A', routes);
    await screen.findByRole('heading', { level: 1 });
    await vi.waitFor(() => {
      expect(api.calls(PROFILE)).toHaveLength(1);
    });
  });

  it('0010c a profile with only "עליי" is nudged to "מה מחפשים"', async () => {
    const api = mockApi({ 'GET /me': [json(noa)], [PROFILE]: [json(personalOnlyProfile())] });
    renderRoutes('/market?rooms=2', routes);
    await settle(api, true);
    expect(screen.getByText(he.match.nudge)).toBeVisible();
    expect(screen.getByRole('link', { name: he.match.fillProfile })).toHaveAttribute(
      'href',
      `/me/profile?section=looking&next=${encodeURIComponent('/market?rooms=2')}`,
    );
  });
});
