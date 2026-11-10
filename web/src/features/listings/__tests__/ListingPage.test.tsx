import { fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { failMap, lastProps, resetFakeMap } from '../../../components/map/__tests__/fakeMapCanvas';
import he from '../../../locales/he.json';
import { deferred, json, mockApi, renderRoutes } from '../../auth/__tests__/harness';
import { listingDetail } from '../../search/__tests__/fixtures';
import { ListingPage } from '../ListingPage';

vi.mock(
  '../../../components/map/MapCanvas',
  () => import('../../../components/map/__tests__/fakeMapCanvas'),
);

afterEach(() => {
  vi.unstubAllGlobals();
  resetFakeMap();
});

const render = (id: string) =>
  renderRoutes(
    `/listings/${id}`,
    <Routes>
      <Route path="/listings/:id" element={<ListingPage />} />
    </Routes>,
  );
const back = () => screen.getAllByRole('link', { name: he.listing.backToSearch });
/** The `<dl>` as `{label: value}`. */
function facts(): Record<string, string> {
  const dl = document.querySelector('dl');
  if (dl === null) throw new Error('no <dl>');
  const pairs: Record<string, string> = {};
  for (const dt of within(dl).getAllByRole('term')) {
    pairs[dt.textContent ?? ''] = dt.nextElementSibling?.textContent ?? '';
  }
  return pairs;
}

// 0002a AC1's listing.
const katznelson = listingDetail({
  city: 'גבעתיים',
  street: 'כצנלסון',
  rooms: 3.5,
  floor: 3,
  total_floors: 5,
  size_sqm: 95,
  price_ils: 7200,
  available_from: '2099-01-01',
  entry_flexible: true,
  elevator: true,
  parking_spots: 1,
  furnished: 'partial',
  pets_allowed: true,
  arnona_ils: 480,
  vaad_ils: 150,
  description: 'דירה מוארת\nקרובה לרכבת',
});

describe('ListingPage', () => {
  it('ac7_public_listing_page', async () => {
    // Pending: skeletons, and the back link already.
    const pending = deferred();
    mockApi({
      'GET /me': [json({ detail: 'unauthenticated' }, 401)],
      [`GET /listings/${katznelson.id}`]: [pending.promise],
    });
    let view = render(katznelson.id);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThanOrEqual(3);
    expect(back()).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // 200: the title block, the facts, the description with its line break, the location.
    mockApi({
      'GET /me': [json({ detail: 'unauthenticated' }, 401)],
      [`GET /listings/${katznelson.id}`]: [json(katznelson)],
    });
    view = render(katznelson.id);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      '3.5 חדרים, רחוב כצנלסון, גבעתיים',
    );
    expect(screen.getByText(/7,200[\s‎‏]*₪/)).toBeVisible();
    expect(screen.getByText(he.listings.units.perMonth)).toBeVisible();
    expect(screen.getByText(he.listings.fields.entryFlexible)).toBeVisible();
    expect(screen.getByText('קומה 3 מתוך 5')).toBeVisible();
    expect(screen.getByText(`95 ${he.listings.units.sqm}`)).toBeVisible();
    const pairs = facts();
    expect(pairs[he.listings.fields.elevator]).toBe(he.listing.yes);
    expect(pairs[he.listings.fields.parking]).toBe(he.listing.parkingOne);
    expect(pairs[he.listings.fields.furnished]).toBe(he.listings.furnished.partial);
    expect(pairs[he.listings.fields.pets]).toBe(he.listing.allowed);
    expect(pairs[he.listings.fields.arnona]).toContain('480');
    expect(pairs[he.listings.fields.vaad]).toContain('150');
    expect(
      screen.getByRole('heading', { level: 2, name: he.listings.fields.description }),
    ).toBeVisible();
    const description = screen.getByTestId('listing-description');
    expect(description.textContent).toContain('\n');
    expect(description.textContent).toBe(katznelson.description);
    expect(screen.getByRole('heading', { level: 2, name: he.listing.location })).toBeVisible();
    expect(screen.getByText('כצנלסון, גבעתיים')).toBeVisible();
    expect(screen.getByText(he.listing.locationHint)).toBeVisible();
    expect(back()).toHaveLength(1);
    expect(back()[0]).toHaveAttribute('href', '/search');
    view.unmount();
    vi.unstubAllGlobals();

    // No arnona / vaad, no description, no parking, no pets, no elevator, entry not flexible.
    const plain = listingDetail({
      arnona_ils: null,
      vaad_ils: null,
      description: null,
      parking_spots: 2,
      available_from: '2020-01-01',
    });
    mockApi({
      'GET /me': [json({ detail: 'unauthenticated' }, 401)],
      [`GET /listings/${plain.id}`]: [json(plain)],
    });
    view = render(plain.id);
    await screen.findByRole('heading', { level: 1 });
    const plainPairs = facts();
    expect(Object.keys(plainPairs)).not.toContain(he.listings.fields.arnona);
    expect(Object.keys(plainPairs)).not.toContain(he.listings.fields.vaad);
    expect(plainPairs[he.listings.fields.elevator]).toBe(he.listing.no);
    expect(plainPairs[he.listings.fields.parking]).toBe('2 מקומות');
    expect(plainPairs[he.listings.fields.pets]).toBe(he.listing.notAllowed);
    expect(screen.getByText(he.listings.card.immediate)).toBeVisible();
    expect(screen.queryByText(he.listings.fields.entryFlexible)).toBeNull();
    expect(screen.queryByRole('heading', { name: he.listings.fields.description })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // 404 and 422: not found, and the top back link is the only one.
    for (const [id, reply] of [
      [katznelson.id, () => json({ detail: 'not_found' }, 404)],
      [
        'not-a-uuid',
        () => json({ detail: [{ type: 'uuid_parsing', loc: ['path'], msg: 'x' }] }, 422),
      ],
    ] as const) {
      mockApi({
        'GET /me': [json({ detail: 'unauthenticated' }, 401)],
        [`GET /listings/${id}`]: [reply()],
      });
      view = render(id);
      expect(
        await screen.findByRole('heading', { level: 1, name: he.listing.notFound }),
      ).toBeVisible();
      expect(back()).toHaveLength(1);
      expect(back()[0]).toHaveAttribute('href', '/search');
      expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
      view.unmount();
      vi.unstubAllGlobals();
    }

    // 500: ErrorState; retry re-requests.
    const api = mockApi({
      'GET /me': [json({ detail: 'unauthenticated' }, 401)],
      [`GET /listings/${katznelson.id}`]: [json({ detail: 'boom' }, 500), json(katznelson)],
    });
    render(katznelson.id);
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('כצנלסון');
    expect(api.calls(`GET /listings/${katznelson.id}`)).toHaveLength(2);
  });

  it('ac6_listing_page_approximate_map', async () => {
    const located = listingDetail({ lat: 32.08, lng: 34.8 });
    const address = i18n.t('listing.address', { street: located.street, city: located.city });
    const section = () =>
      screen.getByRole('heading', { level: 2, name: he.listing.location }).closest('section');

    // A point: the approximate map inside "location", above the text that stays.
    mockApi({
      'GET /me': [json({ detail: 'unauthenticated' }, 401)],
      [`GET /listings/${located.id}`]: [json(located)],
    });
    let view = render(located.id);
    const region = await screen.findByRole('region', { name: he.listing.mapLabel });
    const location = section();
    expect(location).not.toBeNull();
    expect(location).toContainElement(region);
    expect(lastProps()).toMatchObject({
      center: [34.8, 32.08],
      zoom: 14,
      interactive: false,
      approximate: true,
    });
    expect(lastProps().pins).toBeUndefined();
    expect(within(region).queryAllByRole('button')).toHaveLength(0);
    expect(within(location as HTMLElement).getByText(address)).toBeVisible();
    expect(within(location as HTMLElement).getByText(he.listing.locationHint)).toBeVisible();

    // The map cannot be shown: it is removed, the text stays.
    failMap();
    expect(screen.queryByRole('region', { name: he.listing.mapLabel })).toBeNull();
    expect(screen.getByText(address)).toBeVisible();
    expect(screen.getByText(he.listing.locationHint)).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();
    resetFakeMap();

    // No point: the section as before, no map.
    const unlocated = listingDetail({ lat: null, lng: null });
    mockApi({
      'GET /me': [json({ detail: 'unauthenticated' }, 401)],
      [`GET /listings/${unlocated.id}`]: [json(unlocated)],
    });
    view = render(unlocated.id);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: he.listing.mapLabel })).toBeNull();
    expect(lastProps).toThrow();
    const plain = section();
    expect(plain?.children).toHaveLength(3);
    expect(
      screen.getByText(
        i18n.t('listing.address', { street: unlocated.street, city: unlocated.city }),
      ),
    ).toBeVisible();
    expect(screen.getByText(he.listing.locationHint)).toBeVisible();
  });
});
