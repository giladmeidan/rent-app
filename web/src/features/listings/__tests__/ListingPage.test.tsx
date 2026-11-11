import { fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { failMap, lastProps, resetFakeMap } from '../../../components/map/__tests__/fakeMapCanvas';
import he from '../../../locales/he.json';
import { deferred, json, mockApi, noa, renderRoutes } from '../../auth/__tests__/harness';
import { formatDate } from '../format';
import { inDays, profile } from '../../profile/__tests__/fixtures';
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

  it('ac8_match_card', async () => {
    // The seeker: budget 7500, two parking spots wanted, move-in in 30 days; the listing has one.
    const scored = listingDetail({
      price_ils: 7200,
      parking_spots: 1,
      available_from: inDays(30),
      min_contract_months: 12,
      match: { score: 87, agrees: ['budget', 'move_in', 'contract'], differs: 'parking' },
    });
    const seeker = (l: typeof scored) => ({
      'GET /me': [json(noa)],
      'GET /me/applications': [json([])],
      'GET /me/profile': [json(profile({ budget_max_ils: 7500, parking_needed: 2 }))],
      [`GET /listings/${l.id}`]: [json(l)],
    });
    mockApi(seeker(scored));
    let view = render(scored.id);
    const section = await screen.findByRole('region', { name: he.match.card.title });
    expect(within(section).getByText('87%')).toBeVisible();
    expect(within(section).getByText('התאמה גבוהה')).toBeVisible();
    expect(within(section).getByText(he.match.card.basis)).toBeVisible();
    const items = await within(section).findAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'התקציב שלך (עד 7,500 ₪) מתאים למחיר',
      `תאריך הכניסה שלך (${formatDate(inDays(30))}) תואם`,
      'משך החוזה שביקשת מתאים',
      'ביקשת 2 חניות — בדירה יש מקום אחד',
    ]);
    // The ✓ / ! icons are decorative.
    for (const li of items) {
      expect(li.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
    expect(within(section).getByRole('link', { name: he.match.card.edit })).toHaveAttribute(
      'href',
      `/me/profile?next=%2Flistings%2F${scored.id}`,
    );
    // The badge sits by the price.
    const badge = screen.getByText('התאמה 87%');
    expect(badge.parentElement).toHaveTextContent(/7,200[\s‎‏]*₪/);
    expect(section).not.toContainElement(badge);
    // The card comes directly before the apply section, after the location.
    const apply = screen.getByRole('region', { name: he.applications.heading });
    const location = screen
      .getByRole('heading', { level: 2, name: he.listing.location })
      .closest('section');
    expect(section.compareDocumentPosition(apply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.nextElementSibling).toBe(apply);
    expect(location?.nextElementSibling).toBe(section);
    view.unmount();
    vi.unstubAllGlobals();

    // `match: null`: no badge, no card.
    const unscored = listingDetail({ match: null });
    mockApi(seeker(unscored));
    view = render(unscored.id);
    expect(await screen.findByRole('region', { name: he.applications.heading })).toBeVisible();
    expect(screen.queryByText(/^התאמה/)).toBeNull();
    expect(screen.queryByRole('region', { name: he.match.card.title })).toBeNull();
  });

  it('ac9_match_card_without_profile_numbers', async () => {
    const scored = listingDetail({
      match: { score: 64, agrees: ['budget', 'area'], differs: 'pets' },
    });
    const section = () => screen.getByRole('region', { name: he.match.card.title });

    // The profile request in flight: score and label, skeleton lines instead of the reasons.
    const pending = deferred();
    let api = mockApi({
      'GET /me': [json(noa)],
      'GET /me/applications': [json([])],
      'GET /me/profile': [pending.promise],
      [`GET /listings/${scored.id}`]: [json(scored)],
    });
    let view = render(scored.id);
    await screen.findByRole('region', { name: he.match.card.title });
    await vi.waitFor(() => {
      expect(api.calls('GET /me/profile')).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect(within(section()).getAllByTestId('skeleton').length).toBeGreaterThan(0);
    });
    expect(within(section()).getByText('64%')).toBeVisible();
    expect(within(section()).getByText('התאמה טובה')).toBeVisible();
    expect(screen.getByText('התאמה 64%')).toBeVisible();
    expect(within(section()).queryAllByRole('listitem')).toHaveLength(0);
    view.unmount();
    vi.unstubAllGlobals();

    // The profile request failed: score and label only, no reasons and no skeleton.
    api = mockApi({
      'GET /me': [json(noa)],
      'GET /me/applications': [json([])],
      'GET /me/profile': [json({ detail: 'boom' }, 500)],
      [`GET /listings/${scored.id}`]: [json(scored)],
    });
    view = render(scored.id);
    await screen.findByRole('region', { name: he.match.card.title });
    await vi.waitFor(() => {
      expect(api.calls('GET /me/profile')).toHaveLength(1);
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(within(section()).getByText('64%')).toBeVisible();
    expect(within(section()).getByText('התאמה טובה')).toBeVisible();
    expect(within(section()).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(section()).queryAllByTestId('skeleton')).toHaveLength(0);
    expect(within(section()).getByRole('link', { name: he.match.card.edit })).toBeVisible();
    view.unmount();
  });
});
