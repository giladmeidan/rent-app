import type { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { failMap, lastProps, resetFakeMap } from '../../../components/map/__tests__/fakeMapCanvas';
import he from '../../../locales/he.json';
import {
  currentPath,
  deferred,
  empty,
  json,
  mockApi,
  noa,
  renderRoutes,
  testQueryClient,
} from '../../auth/__tests__/harness';
import { formatDate } from '../format';
import { inDays, profile } from '../../profile/__tests__/fixtures';
import { application } from '../../applications/__tests__/fixtures';
import { CONVERSATIONS_KEY } from '../../chat/useConversations';
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

const render = (id: string, client?: QueryClient) =>
  renderRoutes(
    `/listings/${id}`,
    <Routes>
      <Route path="/listings/:id" element={<ListingPage />} />
    </Routes>,
    client,
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
    expect(pairs[he.listings.fields.parking]).toBe(i18n.t('listing.parking', { count: 1 }));
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

  it('ac3_facts_parking_forms', async () => {
    for (const [parking_spots, text] of [
      [1, '\u05de\u05e7\u05d5\u05dd \u05d0\u05d7\u05d3'],
      [2, '2 \u05de\u05e7\u05d5\u05de\u05d5\u05ea'],
      [0, '\u05d0\u05d9\u05df'],
    ] as const) {
      const l = listingDetail({ parking_spots });
      mockApi({
        'GET /me': [json({ detail: 'unauthenticated' }, 401)],
        [`GET /listings/${l.id}`]: [json(l)],
      });
      const view = render(l.id);
      await screen.findByRole('heading', { level: 1 });
      expect(facts()[he.listings.fields.parking]).toBe(text);
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac4_room_facts_furnished', async () => {
    const l = listingDetail({ listing_type: 'room', furnished: 'full' });
    mockApi({
      'GET /me': [json({ detail: 'unauthenticated' }, 401)],
      [`GET /listings/${l.id}`]: [json(l)],
    });
    render(l.id);
    await screen.findByRole('heading', { level: 1 });
    expect(facts()[he.listings.fields.furnished]).toBe('\u05de\u05e8\u05d5\u05d4\u05d8');
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

  it('ac7_owner_looks_for', async () => {
    const title = he.listing.ownerLooksFor.title;
    const following = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

    // Two households, no smokers, a year: the region after "location", before applying.
    const picky = listingDetail({
      accepted_households: ['single', 'couple'],
      smoking_allowed: false,
      min_contract_months: 12,
    });
    mockApi({
      'GET /me': [json({ detail: 'unauthenticated' }, 401)],
      [`GET /listings/${picky.id}`]: [json(picky)],
    });
    let view = render(picky.id);
    const region = await screen.findByRole('region', { name: title });
    expect(within(region).getByRole('heading', { level: 2, name: title })).toBeVisible();
    expect(
      within(region)
        .getAllByRole('listitem')
        .map((chip) => chip.textContent),
    ).toEqual(['יחיד/ה או זוג', 'ללא מעשנים', 'חוזה לשנה לפחות']);
    const location = screen
      .getByRole('heading', { level: 2, name: he.listing.location })
      .closest('section') as HTMLElement;
    expect(following(location, region)).toBe(true);
    expect(location).not.toContainElement(region);
    expect(following(region, await screen.findByText(he.applications.loginPrompt))).toBe(true);
    view.unmount();
    vi.unstubAllGlobals();

    // Three households in any order: canonical order, joined "a, b or c"; nothing else set.
    const three = listingDetail({ accepted_households: ['family', 'single', 'couple'] });
    mockApi({
      'GET /me': [json({ detail: 'unauthenticated' }, 401)],
      [`GET /listings/${three.id}`]: [json(three)],
    });
    view = render(three.id);
    const threeRegion = await screen.findByRole('region', { name: title });
    expect(
      within(threeRegion)
        .getAllByRole('listitem')
        .map((chip) => chip.textContent),
    ).toEqual(['יחיד/ה, זוג או משפחה']);
    view.unmount();
    vi.unstubAllGlobals();

    // Every household, smoking allowed, no minimum: no section at all.
    const open = listingDetail({
      accepted_households: ['single', 'couple', 'family', 'roommates'],
      smoking_allowed: true,
      min_contract_months: null,
    });
    mockApi({
      'GET /me': [json({ detail: 'unauthenticated' }, 401)],
      [`GET /listings/${open.id}`]: [json(open)],
    });
    render(open.id);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: title })).toBeNull();
    expect(screen.queryByText(title)).toBeNull();
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
    // The card comes directly before the apply section, after the location and the owner's
    // preferences (0006e; this listing's minimum contract renders that section).
    const apply = screen.getByRole('region', { name: he.applications.heading });
    const location = screen
      .getByRole('heading', { level: 2, name: he.listing.location })
      .closest('section');
    const ownerLooksFor = screen.getByRole('region', { name: he.listing.ownerLooksFor.title });
    expect(section.compareDocumentPosition(apply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.nextElementSibling).toBe(apply);
    expect(location?.nextElementSibling).toBe(ownerLooksFor);
    expect(ownerLooksFor.nextElementSibling).toBe(section);
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

  it('ac7_room_facts_and_lifestyle', async () => {
    const visitor = { 'GET /me': [json({ detail: 'unauthenticated' }, 401)] };
    const roomFacts = () => screen.getByRole('region', { name: he.rooms.facts.title });
    /** A `<dl>` of `section` as `["label: value", …]`. */
    const rowsOf = (dl: HTMLElement) =>
      within(dl)
        .getAllByRole('term')
        .map((dt) => `${dt.textContent ?? ''}: ${dt.nextElementSibling?.textContent ?? ''}`);
    const show = async (overrides: Parameters<typeof listingDetail>[0]) => {
      const l = listingDetail({
        listing_type: 'room',
        rooms: 3,
        street: 'הרצל',
        city: 'תל אביב',
        gender_preference: 'men',
        flatmates_count: 2,
        flatmate_ages: [27, 30],
        lifestyle: { cleanliness: 3, kosher: 1 },
        description: 'חדר מואר',
        ...overrides,
      });
      mockApi({ ...visitor, [`GET /listings/${l.id}`]: [json(l)] });
      const view = render(l.id);
      await screen.findByRole('heading', { level: 1 });
      return view;
    };

    // A seeker's response: the title, who it is for, the flatmates with ages, and the flat's
    // lifestyle in the questionnaire's order.
    let view = await show({});
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'חדר ב\u05be3 חדרים, רחוב הרצל, תל אביב',
    );
    expect(rowsOf(within(roomFacts()).getByTestId('room-facts'))).toEqual([
      'העדפת מגדר: גברים',
      'שותפים בדירה: 2 שותפים (27, 30)',
    ]);
    const lifestyleHeading = within(roomFacts()).getByRole('heading', {
      level: 3,
      name: he.lifestyle.title.flat,
    });
    const lifestyle = within(roomFacts()).getByTestId('room-lifestyle');
    expect(lifestyleHeading.nextElementSibling).toBe(lifestyle);
    expect(rowsOf(lifestyle)).toEqual(['ניקיון: בקפדנות', 'כשרות: לא כשר']);
    // After the facts grid, before the description.
    const section = roomFacts();
    expect(section.previousElementSibling?.tagName).toBe('DL');
    expect(section.nextElementSibling).toContainElement(screen.getByTestId('listing-description'));
    view.unmount();
    vi.unstubAllGlobals();

    // No answers: no lifestyle heading.
    view = await show({ lifestyle: {} });
    expect(
      within(roomFacts()).queryByRole('heading', { name: he.lifestyle.title.flat }),
    ).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // A visitor's or an owner's response (room privacy): no ages, no answers, nothing empty.
    view = await show({ flatmate_ages: [], lifestyle: {} });
    expect(rowsOf(within(roomFacts()).getByTestId('room-facts'))).toEqual([
      'העדפת מגדר: גברים',
      'שותפים בדירה: 2 שותפים',
    ]);
    expect(roomFacts()).not.toHaveTextContent('(');
    expect(within(roomFacts()).getAllByRole('heading')).toHaveLength(1);
    expect(within(roomFacts()).queryByTestId('room-lifestyle')).toBeNull();
    expect(screen.queryByText(he.lifestyle.title.flat)).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // Any gender; a legacy room without a count.
    view = await show({ gender_preference: 'any', flatmates_count: null, flatmate_ages: [] });
    expect(rowsOf(within(roomFacts()).getByTestId('room-facts'))).toEqual(['העדפת מגדר: לא משנה']);
    view.unmount();
    vi.unstubAllGlobals();

    // An apartment: no room section.
    const flat = listingDetail();
    mockApi({ ...visitor, [`GET /listings/${flat.id}`]: [json(flat)] });
    render(flat.id);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: he.rooms.facts.title })).toBeNull();
    expect(screen.queryByText(he.rooms.facts.title)).toBeNull();
  });

  it('ac11_match_card_lifestyle', async () => {
    const room = listingDetail({
      listing_type: 'room',
      flatmates_count: 2,
      price_ils: 7200,
      lifestyle: { cleanliness: 3, guests: 1, night: 2 },
      match: { score: 90, agrees: ['budget', 'lifestyle'], differs: null },
    });
    mockApi({
      'GET /me': [json(noa)],
      'GET /me/applications': [json([])],
      'GET /me/profile': [
        json(
          profile({
            budget_max_ils: 7500,
            lifestyle: { cleanliness: 3, guests: 1, night: 3, kosher: 1 },
          }),
        ),
      ],
      [`GET /listings/${room.id}`]: [json(room)],
    });
    render(room.id);
    const section = await screen.findByRole('region', { name: he.match.card.title });
    const items = await within(section).findAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'התקציב שלך (עד 7,500 ₪) מתאים למחיר',
      'אורח החיים שלך קרוב לזה שבדירה (תשובות זהות: 2 מתוך 3)',
    ]);
  });

  describe('likes (0008c)', () => {
    const likeRoom = (like: { liked_by_me: boolean; liked_me: boolean } | null, over = {}) =>
      listingDetail({ listing_type: 'room', like, room_fit: true, ...over });
    const seekerApi = (
      room: ReturnType<typeof likeRoom>,
      extra: Parameters<typeof mockApi>[0] = {},
    ) =>
      mockApi({
        'GET /me': [json(noa)],
        'GET /me/applications': [json([])],
        'GET /me/profile': [json(profile({ gender: 'woman' }))],
        [`GET /listings/${room.id}`]: [json(room)],
        ...extra,
      });
    const likeButton = () => screen.findByRole('button', { name: he.likes.like });

    it('ac2_like_back_mutual', async () => {
      const room = likeRoom({ liked_by_me: false, liked_me: true });
      const api = seekerApi(room, {
        [`PUT /listings/${room.id}/like`]: [json({ liked: true, application_id: 'X' })],
      });
      const client = testQueryClient();
      client.setQueryData(CONVERSATIONS_KEY, []);
      render(room.id, client);
      const button = await likeButton();
      expect(screen.getByText(he.likes.likedYouLine)).toBeVisible();
      const apply = await screen.findByRole('button', { name: he.applications.apply });
      expect(button.compareDocumentPosition(apply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      fireEvent.click(button);
      const banner = (await screen.findByText(he.likes.mutual)).closest<HTMLElement>(
        '[role="status"]',
      ) as HTMLElement;
      expect(within(banner).getByText(he.likes.mutual)).toBeVisible();
      expect(within(banner).getByRole('link', { name: he.likes.toChat })).toHaveAttribute(
        'href',
        '/chat/X',
      );
      expect(screen.queryByRole('button', { name: he.likes.like })).toBeNull();
      // Focus moves to the chat link when the clicked button unmounts.
      expect(within(banner).getByRole('link', { name: he.likes.toChat })).toHaveFocus();
      // The chats list is stale: the new chat shows up.
      expect(client.getQueryState(CONVERSATIONS_KEY)?.isInvalidated).toBe(true);
      // The applications refetch (the new shortlisted one); the banner outlives the caches.
      await vi.waitFor(() => {
        expect(api.calls('GET /me/applications').length).toBeGreaterThanOrEqual(2);
      });
      expect(screen.getByText(he.likes.mutual)).toBeVisible();
      expect(api.calls(`GET /listings/${room.id}`)).toHaveLength(1);
    });

    it('ac3_like_toggle_and_absent', async () => {
      const room = likeRoom({ liked_by_me: false, liked_me: false });
      const route = `PUT /listings/${room.id}/like`;
      const api = seekerApi(room, {
        [route]: [json({ liked: true, application_id: null })],
        [`DELETE /listings/${room.id}/like`]: [empty()],
      });
      render(room.id);
      const button = await likeButton();
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByText(he.likes.likedYouLine)).toBeNull();
      // Idle: the hint under the button, tied to it.
      expect(button).toHaveAccessibleDescription(he.likes.hint);
      fireEvent.click(button);
      const pressed = await screen.findByRole('button', { name: he.likes.unlikeLabel });
      expect(pressed).toHaveAttribute('aria-pressed', 'true');
      expect(pressed).toHaveTextContent(he.likes.liked);
      expect(screen.queryByText(he.likes.hint)).toBeNull();
      await vi.waitFor(() => {
        expect(pressed).toBeEnabled();
      });
      fireEvent.click(pressed);
      expect(await screen.findByRole('button', { name: he.likes.like })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      expect(api.calls(route)).toHaveLength(1);
      expect(api.calls(`DELETE /listings/${room.id}/like`)).toHaveLength(1);
      expect(api.calls(`GET /listings/${room.id}`)).toHaveLength(1);

      // No control: anonymous / an apartment / an open application (`like: null`), or a misfit.
      const absents = [
        [likeRoom(null), he.applications.apply],
        [
          likeRoom({ liked_by_me: false, liked_me: true }, { room_fit: false }),
          he.rooms.apply.misfit,
        ],
      ] as const;
      for (const [absent, settled] of absents) {
        cleanup();
        vi.unstubAllGlobals();
        seekerApi(absent);
        render(absent.id);
        await screen.findByRole('heading', { level: 1 });
        // The apply section has settled, so a like control would be on the page by now.
        expect(await screen.findByText(settled)).toBeVisible();
        expect(screen.queryByRole('button', { name: he.likes.like })).toBeNull();
        expect(screen.queryByText(he.likes.likedYouLine)).toBeNull();
      }
    });

    it('ac4_like_errors', async () => {
      const cases: {
        reply: () => Response;
        applications?: (id: string) => Response[];
        check: (id: string, api: ReturnType<typeof mockApi>) => Promise<void>;
      }[] = [
        ...['room_section_required', 'seeker_profile_required'].map((code) => ({
          reply: () => json({ detail: code }, 409),
          check: async (id: string) => {
            expect(await screen.findByText(he.likes.errors.roomSection)).toBeVisible();
            expect(screen.getByRole('link', { name: he.likes.toProfile })).toHaveAttribute(
              'href',
              `/me/profile?section=room&next=${encodeURIComponent(`/listings/${id}`)}`,
            );
          },
        })),
        {
          reply: () => json({ detail: 'room_gender_mismatch' }, 409),
          check: async () => {
            expect(await screen.findByText(he.rooms.apply.misfit)).toBeVisible();
            expect(screen.queryByRole('button', { name: he.likes.like })).toBeNull();
            expect(screen.queryByRole('alert')).toBeNull();
          },
        },
        {
          reply: () => json({ detail: 'already_applied' }, 409),
          check: async (_id, api) => {
            await vi.waitFor(() => {
              expect(api.calls('GET /me/applications').length).toBeGreaterThanOrEqual(2);
            });
            expect(screen.queryByRole('button', { name: he.likes.like })).toBeNull();
            // ApplySection now shows the application the refetch returned.
            expect(await screen.findByText(/הגשת מועמדות ב־/)).toBeVisible();
          },
          applications: (id: string) => [
            json([]),
            json([{ ...application(), listing: { ...application().listing, id } }]),
          ],
        },
        {
          reply: () => json({ detail: 'boom' }, 500),
          check: async () => {
            expect(await screen.findByText(he.common.error)).toBeVisible();
          },
        },
        {
          reply: () => json({ detail: 'not_found' }, 404),
          check: async () => {
            expect(await screen.findByText(he.likes.errors.gone)).toBeVisible();
          },
        },
        {
          reply: () => json({ detail: 'rate_limited' }, 429),
          check: async () => {
            expect(await screen.findByText(he.likes.errors.rateLimited)).toBeVisible();
          },
        },
        {
          reply: () => json({ detail: 'unauthenticated' }, 401),
          check: async (id) => {
            await vi.waitFor(() => {
              expect(currentPath()).toBe(`/login?next=${encodeURIComponent(`/listings/${id}`)}`);
            });
          },
        },
      ];
      for (const { reply, check, applications } of cases) {
        const room = likeRoom({ liked_by_me: false, liked_me: false });
        const api = seekerApi(room, {
          [`PUT /listings/${room.id}/like`]: [reply],
          ...(applications ? { 'GET /me/applications': applications(room.id) } : {}),
        });
        render(room.id);
        const button = await likeButton();
        // The applications list has loaded (its query is enabled once `/me` answers).
        await screen.findByRole('button', { name: he.applications.apply });
        fireEvent.click(button);
        await check(room.id, api);
        // A 401 forgets the session, which resets the listing queries (as `useApply`'s does).
        if (!currentPath()?.startsWith('/login')) {
          expect(api.calls(`GET /listings/${room.id}`)).toHaveLength(1);
        }
        cleanup();
        vi.unstubAllGlobals();
      }
    });

    it('ac2_mutual_shows_as_mutual_not_applied', async () => {
      const room = likeRoom({ liked_by_me: false, liked_me: true });
      const app = application({ source: 'like', message: null, status: 'shortlisted' });
      const api = seekerApi(room, {
        [`PUT /listings/${room.id}/like`]: [json({ liked: true, application_id: app.id })],
        'GET /me/applications': [
          json([]),
          json([{ ...app, listing: { ...app.listing, id: room.id } }]),
        ],
      });
      render(room.id);
      fireEvent.click(await likeButton());
      await vi.waitFor(() => {
        expect(screen.getAllByTestId('application-mutual').length).toBeGreaterThan(0);
      });
      expect(screen.getAllByText(he.applications.mutual).length).toBeGreaterThan(0);
      expect(screen.queryByText(/הגשת מועמדות ב־/)).toBeNull();
      expect(screen.getByText(i18n.t('applications.count', { count: 1 }))).toBeVisible();
      expect(api.calls(`GET /listings/${room.id}`)).toHaveLength(1);
    });

    it('like_double_click_sends_one_put', async () => {
      const room = likeRoom({ liked_by_me: false, liked_me: true });
      const api = seekerApi(room, {
        [`PUT /listings/${room.id}/like`]: [json({ liked: true, application_id: 'X' })],
      });
      render(room.id);
      const button = await likeButton();
      fireEvent.click(button);
      fireEvent.click(button);
      expect(await screen.findByText(he.likes.mutual)).toBeVisible();
      expect(api.calls(`PUT /listings/${room.id}/like`)).toHaveLength(1);
    });

    it('ac3_apply_ends_the_like_control', async () => {
      const room = likeRoom({ liked_by_me: false, liked_me: true });
      const app = application({ status: 'submitted' });
      const api = seekerApi(room, {
        [`POST /listings/${room.id}/applications`]: [
          json({ ...app, listing: { ...app.listing, id: room.id } }, 201),
        ],
      });
      render(room.id);
      fireEvent.click(await screen.findByRole('button', { name: he.applications.apply }));
      fireEvent.change(screen.getByLabelText(he.applications.form.label), {
        target: { value: 'שלום' },
      });
      fireEvent.click(screen.getByRole('button', { name: he.applications.form.submit }));
      expect(await screen.findByText(he.applications.sent)).toBeVisible();
      expect(screen.queryByRole('button', { name: he.likes.like })).toBeNull();
      expect(screen.queryByText(he.likes.likedYouLine)).toBeNull();
      expect(api.calls(`GET /listings/${room.id}`)).toHaveLength(1);
    });
  });
});
