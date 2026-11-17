import { act, fireEvent, screen, within } from '@testing-library/react';
import { Link, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import {
  currentPath,
  deferred,
  empty,
  json,
  mockApi,
  networkError,
  renderRoutes,
  testQueryClient,
} from '../../auth/__tests__/harness';
import { ME_KEY } from '../../auth/useMe';
import type { GenderPreference, Household, ListingOut, PhotoOut, Shelter } from '../api';
import { EditListingPage } from '../EditListingPage';
import { ListingWizard } from '../ListingWizard';
import { MarketMinePage } from '../../market/MarketMinePage';
import { NewListingPage } from '../NewListingPage';
import { MY_LISTINGS_KEY } from '../useMyListings';
import { gushDan, listing, owner, seeker, withoutCounts } from './fixtures';
import {
  areasLoaded,
  chooseApartmentAndContinue,
  chooseTypeAndContinue,
  errorFor,
  fillValidDetails,
  IN_30_DAYS,
  meClient,
  nextButton,
  progress,
  renderWizard,
  routes,
  toPreferences,
} from './wizard';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stepItem = (name: string) => screen.getByText(name).closest('li') as HTMLElement;
const publishButton = () => screen.getByRole('button', { name: he.listings.publish });

/** As `toPreferences`, then on to the preview with the preferences untouched. */
async function toPreview(client = testQueryClient()) {
  const view = await toPreferences(client);
  fireEvent.click(nextButton());
  expect(progress()).toHaveAttribute('aria-valuenow', '5');
  return view;
}

const p = he.listings.prefs;
const household = (name: string) => screen.getByRole('checkbox', { name });
const households = () => screen.getByRole('group', { name: p.households });
const noSmokers = () => screen.getByRole('switch', { name: p.noSmokers });
const minContract = () => screen.getByLabelText(p.minContract);
const ALL_HOUSEHOLDS = [
  p.household.single,
  p.household.couple,
  p.household.family,
  p.household.roommates,
];

const expectedBody = {
  listing_type: 'apartment',
  rooms: 3.5,
  floor: 3,
  total_floors: 5,
  size_sqm: 95,
  price_ils: 7200,
  available_from: IN_30_DAYS,
  entry_flexible: false,
  elevator: true,
  parking_spots: 1,
  furnished: 'partial',
  pets_allowed: true,
  arnona_ils: null,
  vaad_ils: null,
  description: 'דירה מוארת',
  street: 'כצנלסון',
  area_id: gushDan.id,
  accepted_households: ['single', 'couple', 'family', 'roommates'] as Household[],
  smoking_allowed: true,
  min_contract_months: null,
  // An apartment always sends the room fields' defaults (0007e).
  gender_preference: 'any' as GenderPreference,
  flatmates_count: null,
  flatmate_ages: [] as number[],
  lifestyle: {},
  // Spec 0015a: the flat's protected space; `fillValidDetails` picks "אין" (required since 0015b).
  shelter: 'none' as Shelter,
  // Spec 0014b: an apartment's three facts, not said.
  balcony: null,
  air_conditioning: null,
  condition: null,
};

const l = he.listings;
const h1 = () => screen.getByRole('heading', { level: 1 });
const h2 = (name: string) => screen.getByRole('heading', { level: 2, name });
const stepOf = (n: number, total = 5) => i18n.t('listings.stepOf', { n, total });
/** The stepper: the `<ol>` that holds the step names (the type step only when reachable). */
const stepper = () => screen.getByText(l.steps.details).closest('ol') as HTMLOListElement;
/** Shown step `n` of `total` (4 when the type step is skipped, spec 0010a; 0010e adds photos). */
const expectStep = (n: number, total = 5) => {
  const items = within(stepper()).getAllByRole('listitem');
  expect(items).toHaveLength(total);
  items.forEach((item, i) => {
    if (i + 1 === n) expect(item).toHaveAttribute('aria-current', 'step');
    else expect(item).not.toHaveAttribute('aria-current');
  });
  expect(progress()).toHaveAttribute('aria-valuenow', String(n));
  expect(progress()).toHaveAttribute('aria-valuemax', String(total));
  expect(screen.getByText(stepOf(n, total))).toBeVisible();
};

/** Prints the `location.state` the wizard navigated with. */
function StatePrinter() {
  const { state } = useLocation() as { state: unknown };
  return <p data-testid="state">{JSON.stringify(state)}</p>;
}

describe('ListingWizard', () => {
  it('ac1_step_headings', async () => {
    mockApi({ 'GET /areas': [json([gushDan])] });
    renderWizard();

    // Step 1: the type; only the step line (no hint).
    expectStep(1);
    expect(progress()).toHaveAccessibleName(l.new.title);
    expect(h2(l.stepTitle.type)).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    fireEvent.click(screen.getByLabelText(l.type.apartment));
    fireEvent.click(nextButton());

    // Step 2: details, with its hint beside the step line.
    expectStep(2);
    expect(h1()).toHaveFocus();
    expect(h2(l.stepTitle.details)).toBeVisible();
    expect(screen.getAllByText(l.stepHint.details)).toHaveLength(1);
    await areasLoaded();
    fillValidDetails();
    fireEvent.click(nextButton());

    // Step 3: the photos (spec 0010e), with the wizard's heading and hint.
    expectStep(3);
    expect(h1()).toHaveFocus();
    expect(h2(l.stepTitle.photos)).toBeVisible();
    expect(screen.getAllByText(l.photos.hint)).toHaveLength(1);
    fireEvent.click(nextButton());

    // Step 4: the preferences' heading and hint come from the wizard, once.
    expectStep(4);
    expect(h1()).toHaveFocus();
    expect(h2(p.title)).toBeVisible();
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(1);
    expect(screen.getAllByText(p.hint)).toHaveLength(1);
    fireEvent.click(nextButton());

    // Step 5: the preview.
    expectStep(5);
    expect(h1()).toHaveFocus();
    expect(h2(l.stepTitle.preview)).toBeVisible();
    expect(screen.getAllByText(l.preview.hint)).toHaveLength(1);

    // Back to 4, 3 and 2: the same headings, the h1 focused each time.
    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    expectStep(4);
    expect(h1()).toHaveFocus();
    expect(h2(p.title)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    expectStep(3);
    expect(h1()).toHaveFocus();
    expect(h2(l.stepTitle.photos)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    expectStep(2);
    expect(h1()).toHaveFocus();
    expect(h2(l.stepTitle.details)).toBeVisible();
  });

  it('ac1_step_headings_room_and_edit', async () => {
    // A room: its own details and preferences headings.
    mockApi({ 'GET /areas': [json([gushDan])] });
    const view = renderWizard();
    chooseTypeAndContinue(l.type.room);
    expect(h2(l.stepTitle.detailsRoom)).toBeVisible();
    await areasLoaded();
    fillValidDetails('room');
    fireEvent.click(nextButton());
    expectStep(3);
    expect(h2(l.stepTitle.photosRoom)).toBeVisible();
    fireEvent.click(nextButton());
    expectStep(4);
    expect(h2(p.titleRoom)).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();

    // Edit mode: the preview says "before saving", and the title is the edit title.
    mockApi({ 'GET /areas': [json([gushDan])] });
    renderRoutes(
      '/edit',
      <Routes>
        <Route path="/edit" element={<ListingWizard listing={listing()} />} />
      </Routes>,
    );
    expect(h1()).toHaveTextContent(l.edit.title);
    expect(progress()).toHaveAccessibleName(l.edit.title);
    await areasLoaded();
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    // No type step in edit mode (spec 0010a): the preview is step 4 of 4.
    expectStep(4, 4);
    expect(h2(l.stepTitle.previewEdit)).toBeVisible();
  });

  it('ac3_households_check_mark', async () => {
    mockApi({ 'GET /areas': [json([gushDan])] });
    await toPreferences();
    const marks = () => document.querySelectorAll('label svg[aria-hidden="true"]');
    const markOf = (name: string) =>
      household(name).closest('div')?.querySelector('label svg[aria-hidden="true"]') ?? null;

    // All four start checked: one mark in each segment.
    expect(marks()).toHaveLength(4);
    fireEvent.click(household(p.household.family));
    expect(household(p.household.family)).not.toBeChecked();
    expect(markOf(p.household.family)).toBeNull();
    expect(markOf(p.household.single)).not.toBeNull();
    expect(marks()).toHaveLength(3);
    fireEvent.click(household(p.household.single));
    expect(marks()).toHaveLength(2);
    fireEvent.click(household(p.household.family));
    expect(markOf(p.household.family)).not.toBeNull();
    expect(marks()).toHaveLength(3);
  });

  it('ac7b_publish_hands_over_celebration', async () => {
    // A publish (201) hands "my listings" `{ published: true }`.
    const api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json(withoutCounts(listing()), 201)],
    });
    const published = renderRoutes(
      '/listings/new',
      <Routes>
        <Route path="/listings/new" element={<NewListingPage />} />
        <Route path="/me/listings" element={<StatePrinter />} />
      </Routes>,
      meClient(),
    );
    chooseApartmentAndContinue();
    await areasLoaded();
    fillValidDetails();
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    fireEvent.click(publishButton());
    expect(await screen.findByTestId('state')).toHaveTextContent(
      '{"published":true,"photosFailed":0}',
    );
    expect(api.calls('POST /listings')).toHaveLength(1);
    expect(currentPath()).toBe('/me/listings');
    published.unmount();
    vi.unstubAllGlobals();

    // An edit's save still hands over `{ saved: true }`.
    const stored = listing();
    mockApi({
      'GET /areas': [json([gushDan])],
      [`PATCH /listings/${stored.id}`]: [json({ ...stored, price_ils: 7500 })],
    });
    renderRoutes(
      '/edit',
      <Routes>
        <Route path="/edit" element={<ListingWizard listing={stored} />} />
        <Route path="/me/listings" element={<StatePrinter />} />
      </Routes>,
    );
    await areasLoaded();
    fireEvent.change(screen.getByLabelText(l.fields.price), { target: { value: '7500' } });
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    fireEvent.click(screen.getByRole('button', { name: l.save }));
    expect(await screen.findByTestId('state')).toHaveTextContent('{"saved":true,"photosFailed":0}');
  });

  it('ac7 editing a room preloads the flat facts and saves only the change', async () => {
    // Spec 0010f AC7.
    const r = l.room;
    const stored = listing({
      listing_type: 'room',
      flatmates_count: 2,
      size_sqm: 60,
      room_size_sqm: 12,
      private_bathroom: true,
      balcony: false,
      bills_included: null,
      poster: 'lives_here',
    });
    const api = mockApi({
      'GET /areas': [json([gushDan])],
      [`PATCH /listings/${stored.id}`]: [json({ ...stored, balcony: null })],
    });
    renderRoutes(
      '/edit',
      <Routes>
        <Route path="/edit" element={<ListingWizard listing={stored} />} />
        <Route path="/market/mine" element={<StatePrinter />} />
      </Routes>,
    );
    await areasLoaded();
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    expectStep(3, 4);
    const radio = (legend: string, name: string) =>
      within(screen.getByRole('group', { name: legend })).getByRole('radio', { name });
    expect(screen.getByLabelText(r.roomSize)).toHaveValue(12);
    expect(radio(r.privateBathroom, he.common.yes)).toBeChecked();
    expect(radio(r.balcony, he.common.no)).toBeChecked();
    expect(radio(r.bills, r.unset)).toBeChecked();
    expect(radio(r.poster.title, r.poster.lives_here)).toBeChecked();
    expect(screen.getByText(r.poster.livesHereHint)).toBeVisible();
    fireEvent.click(radio(r.balcony, r.unset));
    fireEvent.click(nextButton());
    fireEvent.click(screen.getByRole('button', { name: l.save }));
    expect(await screen.findByTestId('state')).toHaveTextContent('"saved":true');
    expect(api.calls(`PATCH /listings/${stored.id}`)[0]?.body).toEqual({ balcony: null });
  });

  it('ac2_type_step_and_back_keeps_state', async () => {
    mockApi({ 'GET /areas': [json([gushDan])] });
    renderWizard();

    expect(screen.getByRole('heading', { level: 1, name: he.listings.new.title })).toBeVisible();
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(progress()).toHaveAttribute('aria-valuemax', '5');
    expect(progress()).toHaveAccessibleName(he.listings.new.title);
    expect(stepItem(he.listings.steps.type)).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('group', { name: he.listings.type.label })).toBeVisible();
    expect(screen.queryByRole('button', { name: he.common.back })).toBeNull();
    expect(nextButton()).toBeDisabled();

    fireEvent.click(screen.getByLabelText(he.listings.type.apartment));
    expect(screen.getByRole('radio', { name: he.listings.type.apartment })).toBeChecked();
    expect(nextButton()).toBeEnabled();
    fireEvent.click(nextButton());

    expect(stepItem(he.listings.steps.details)).toHaveAttribute('aria-current', 'step');
    expect(stepItem(he.listings.steps.type)).not.toHaveAttribute('aria-current');
    expect(progress()).toHaveAttribute('aria-valuenow', '2');
    await areasLoaded();
    expect(screen.getByLabelText(he.listings.fields.city)).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(stepItem(he.listings.steps.type)).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('radio', { name: he.listings.type.apartment })).toBeChecked();
    expect(screen.getByRole('radio', { name: he.listings.type.room })).not.toBeChecked();
    expect(nextButton()).toBeEnabled();
  });

  it('ac4_preview_then_publish_navigates', async () => {
    const older = listing({ street: 'הרצל', created_at: '2026-11-01T10:00:00Z' });
    // The POST answers a `ListingOut`: no applicant counts.
    const created = withoutCounts(
      listing({ ...expectedBody, listing_type: 'apartment', furnished: 'partial' }),
    );
    const post = deferred();
    const refetch = deferred();
    const api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [post.promise],
      'GET /me/listings': [refetch.promise],
    });
    const client = testQueryClient();
    client.setQueryData<ListingOut[]>(MY_LISTINGS_KEY, [older]);
    await toPreview(client);

    // The preview card.
    expect(screen.getByText(he.listings.preview.hint)).toBeVisible();
    const card = screen.getByRole('article');
    expect(
      within(card).getByRole('heading', {
        name: i18n.t('listings.card.title', {
          count: 3.5,
          rooms: '3.5',
          street: 'כצנלסון',
          // The chosen settlement's name, as the server will store it (spec 0021a1).
          city: gushDan.name_he,
        }),
      }),
    ).toBeVisible();
    expect(within(card).getByText('7,200 ₪')).toBeVisible();
    expect(within(card).getByText(he.listings.units.perMonth)).toBeVisible();
    expect(
      within(card).getByText(i18n.t('listings.card.floorOf', { floor: 3, total: 5 })),
    ).toBeVisible();
    // The features read in the facts line, in this order; no chip list on an apartment.
    const facts = within(card).getByTestId('listing-facts').textContent ?? '';
    const at = ['מעלית', 'חניה', 'מרוהטת חלקית', 'חיות מחמד'].map((text) => facts.indexOf(text));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(within(card).queryByTestId('listing-chips')).toBeNull();

    // Publish.
    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(publishButton()).toBeDisabled();
    });
    expect(publishButton()).toHaveAttribute('aria-busy', 'true');
    const [call] = api.calls('POST /listings');
    expect(api.calls('POST /listings')).toHaveLength(1);
    expect(call?.body).toEqual(expectedBody);
    expect(call?.request.credentials).toBe('include');

    post.resolve(json(created, 201));
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    // The seeded cache already has the new card first, while the refetch is still in flight.
    expect(screen.queryAllByTestId('skeleton')).toHaveLength(0);
    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('כצנלסון');
    expect(cards[1]).toHaveTextContent('הרצל');
    // The new card has no applicants yet (the cache adds zero counts).
    const applicantsLink = within(cards[0] as HTMLElement)
      .getAllByRole('link')
      .find((a) => a.getAttribute('href') === `/me/listings/${created.id}/applicants`);
    expect(applicantsLink).toHaveAccessibleName(i18n.t('applicants.link', { count: 0 }));
    expect(applicantsLink?.textContent).not.toContain(i18n.t('applicants.newBadge', { count: 0 }));
    expect(
      within(applicantsLink as HTMLElement).queryByText(
        i18n.t('applicants.newBadge', { count: 0 }),
      ),
    ).toBeNull();
    expect(api.calls('GET /me/listings')).toHaveLength(1);

    refetch.resolve(json([{ ...created, applicant_count: 0, new_applicant_count: 0 }, older]));
    await vi.waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(2);
    });
  });

  it('ac3_room_preview_flatmates', async () => {
    const r = he.listings.room;
    const chips = () =>
      within(screen.getByRole('list', { name: r.title }))
        .getAllByRole('listitem')
        .map((chip) => chip.textContent);
    const back = () => fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    mockApi({ 'GET /areas': [json([gushDan])] });
    await toPreferences(testQueryClient(), 'room');
    // Two flatmates, one age given: the missing one is "?".
    fireEvent.change(screen.getByLabelText(r.flatmatesCount), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText(r.ageOf.replace('{{n}}', '1')), {
      target: { value: '30' },
    });
    fireEvent.click(nextButton());
    expect(chips()).toEqual([
      '2 \u05e9\u05d5\u05ea\u05e4\u05d9\u05dd \u05d1\u05d3\u05d9\u05e8\u05d4 (30, ?)',
    ]);
    // One flatmate aged 30.
    back();
    fireEvent.change(screen.getByLabelText(r.flatmatesCount), { target: { value: '1' } });
    fireEvent.click(nextButton());
    expect(chips()).toEqual([
      '\u05d0\u05d3\u05dd \u05d0\u05d7\u05d3 \u05d1\u05d3\u05d9\u05e8\u05d4 (30)',
    ]);
  });

  it('ac12_cap_from_me', async () => {
    // Spec 0012a: the cap error names the account's own cap from `GET /me`.
    mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json({ detail: 'listing_cap_reached' }, 409)],
    });
    let client = meClient({ ...owner, listing_cap: 10 });
    let view = await toPreview(client);
    fireEvent.click(publishButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(i18n.t('listings.errors.capReached', { cap: 10 }));
    expect(alert).not.toHaveTextContent(i18n.t('listings.errors.capReached', { cap: 3 }));
    view.unmount();
    vi.unstubAllGlobals();

    // Without `me` (gone from the cache): the generic text, never a bare `{{cap}}`.
    mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json({ detail: 'listing_cap_reached' }, 409)],
    });
    client = meClient();
    view = await toPreview(client);
    act(() => {
      client.setQueryData(ME_KEY, null);
    });
    fireEvent.click(publishButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    expect(screen.queryByText(/\{\{cap\}\}/)).toBeNull();
    view.unmount();
  });

  it('ac5_publish_errors', async () => {
    const alertText = () => screen.getByRole('alert').textContent;

    // 409: cap reached, still on step 4.
    mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json({ detail: 'listing_cap_reached' }, 409)],
    });
    let view = await toPreview();
    fireEvent.click(publishButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('listings.errors.capReached', { cap: 3 }),
    );
    expect(alertText()).toContain('3');
    expect(progress()).toHaveAttribute('aria-valuenow', '5');
    expect(publishButton()).toBeEnabled();
    view.unmount();
    vi.unstubAllGlobals();

    // Network error: common.error + retry; retry re-POSTs.
    let api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [networkError, json({ detail: 'listing_cap_reached' }, 409)],
    });
    view = await toPreview();
    fireEvent.click(publishButton());
    const retry = await screen.findByRole('button', { name: he.common.retry });
    expect(screen.getByRole('alert')).toHaveTextContent(he.common.error);
    fireEvent.click(retry);
    await vi.waitFor(() => {
      expect(api.calls('POST /listings')).toHaveLength(2);
    });
    expect(await screen.findByText(i18n.t('listings.errors.capReached', { cap: 3 }))).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();

    // 422 unknown_area: area inactive, with a way back to step 2.
    mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json({ detail: 'unknown_area' }, 422)],
    });
    view = await toPreview();
    fireEvent.click(publishButton());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(he.listings.errors.areaInactive);
    fireEvent.click(within(alert).getByRole('button', { name: he.listings.preview.backToDetails }));
    expect(progress()).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByLabelText(he.listings.fields.city)).toHaveValue('גבעתיים');
    view.unmount();
    vi.unstubAllGlobals();

    // 422 with a model-level list detail: common.error, no retry.
    mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [
        json({ detail: [{ loc: ['body'], msg: 'bad', type: 'value_error' }] }, 422),
      ],
    });
    view = await toPreview();
    fireEvent.click(publishButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // 422 naming a field: back on step 2, the error under city and focus on it (not the <h1>);
    // a blur out of city keeps it.
    mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [
        json({ detail: [{ loc: ['body', 'city'], msg: 'bad', type: 'value_error' }] }, 422),
      ],
    });
    view = await toPreview();
    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(progress()).toHaveAttribute('aria-valuenow', '2');
    });
    const city = screen.getByLabelText(he.listings.fields.city);
    expect(errorFor(city)).toHaveTextContent(he.listings.errors.invalid);
    expect(document.activeElement).toBe(city);
    act(() => {
      screen.getByLabelText(he.listings.fields.street).focus();
    });
    expect(document.activeElement).not.toBe(city);
    expect(errorFor(city)).toHaveTextContent(he.listings.errors.invalid);
    expect(screen.queryByText('bad')).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // 401 → /login; 403 → /.
    for (const [status, detail, target] of [
      [401, 'unauthenticated', '/login'],
      [403, 'owner_only', '/'],
    ] as const) {
      api = mockApi({
        'GET /me': [json(owner)],
        'GET /areas': [json([gushDan])],
        'POST /listings': [json({ detail }, status)],
      });
      view = await toPreview();
      fireEvent.click(publishButton());
      await vi.waitFor(() => {
        expect(currentPath()).toBe(target);
      });
      expect(api.calls('POST /listings')).toHaveLength(1);
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac3_rate_limited_publish_says_when', async () => {
    const limited = (after?: string) =>
      json({ detail: 'rate_limited' }, 429, after === undefined ? {} : { 'Retry-After': after });
    const cases: [string | undefined, string][] = [
      ['840', 'הרבה פעולות על מודעות בזמן קצר. אפשר לנסות שוב בעוד 14 דקות.'],
      [undefined, he.listings.errors.rateLimited],
    ];
    for (const [after, text] of cases) {
      mockApi({ 'GET /areas': [json([gushDan])], 'POST /listings': [limited(after)] });
      const view = await toPreview();
      fireEvent.click(publishButton());
      expect((await screen.findByRole('alert')).textContent).toBe(text);
      view.unmount();
      vi.unstubAllGlobals();
    }

    // The edit wizard's PATCH says the same.
    const stored = listing({});
    mockApi({
      'GET /areas': [json([gushDan])],
      [`PATCH /listings/${stored.id}`]: [limited('840')],
    });
    renderRoutes('/edit', <ListingWizard listing={stored} />);
    await areasLoaded();
    fireEvent.change(screen.getByLabelText(l.fields.price), { target: { value: '7500' } });
    for (let i = 0; i < 3; i++) fireEvent.click(nextButton());
    fireEvent.click(screen.getByRole('button', { name: l.save }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'הרבה פעולות על מודעות בזמן קצר. אפשר לנסות שוב בעוד 14 דקות.',
    );
  });

  it('ac4_publish_double_click_posts_once', async () => {
    const post = deferred();
    const api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [post.promise],
      'GET /me/listings': [json([])],
    });
    await toPreview();

    // Both clicks land before React re-renders the button as disabled.
    act(() => {
      fireEvent.click(publishButton());
      fireEvent.click(publishButton());
    });
    await vi.waitFor(() => {
      expect(publishButton()).toBeDisabled();
    });
    expect(api.calls('POST /listings')).toHaveLength(1);

    post.resolve(json(listing(), 201));
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    expect(api.calls('POST /listings')).toHaveLength(1);
  });

  it('ac1_four_steps', async () => {
    mockApi({ 'GET /areas': [json([gushDan])] });
    const view = renderWizard();
    const s = he.listings.steps;
    const names = [s.type, s.details, s.photos, s.preferences, s.preview];

    const items = within(stepItem(s.type).closest('ol') as HTMLElement).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    items.forEach((item, i) => {
      expect(item).toHaveTextContent(names[i] as string);
    });
    expect(progress()).toHaveAttribute('aria-valuemin', '1');
    expect(progress()).toHaveAttribute('aria-valuemax', '5');
    const at = (n: number) => {
      expect(progress()).toHaveAttribute('aria-valuenow', String(n));
      names.forEach((name, i) => {
        if (i + 1 === n) expect(stepItem(name)).toHaveAttribute('aria-current', 'step');
        else expect(stepItem(name)).not.toHaveAttribute('aria-current');
      });
    };

    at(1);
    chooseApartmentAndContinue();
    at(2);
    await areasLoaded();
    fillValidDetails();
    fireEvent.click(nextButton());
    at(3);
    fireEvent.click(nextButton());
    at(4);
    expect(screen.getByRole('heading', { level: 2, name: p.title })).toBeVisible();
    expect(screen.getByText(p.hint)).toBeVisible();
    // The defaults: every household, smokers welcome, no minimum.
    for (const name of ALL_HOUSEHOLDS) expect(household(name)).toBeChecked();
    expect(noSmokers()).not.toBeChecked();
    expect(minContract()).toHaveValue('');
    expect(minContract()).toHaveDisplayValue(p.contract.none);
    fireEvent.click(household(p.household.family));
    fireEvent.click(noSmokers());
    fireEvent.change(minContract(), { target: { value: '36' } });
    fireEvent.click(nextButton());
    at(5);
    expect(screen.getByRole('button', { name: he.listings.publish })).toBeVisible();

    // Back: preview → preferences → photos → details → type, every value kept.
    const back = () => fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    back();
    at(4);
    expect(household(p.household.single)).toBeChecked();
    expect(household(p.household.family)).not.toBeChecked();
    expect(noSmokers()).toBeChecked();
    expect(minContract()).toHaveDisplayValue(p.contract['36']);
    back();
    at(3);
    back();
    at(2);
    expect(screen.getByLabelText(he.listings.fields.city)).toHaveValue('גבעתיים');
    expect(screen.getByRole('switch', { name: he.listings.fields.pets })).toBeChecked();
    back();
    at(1);
    expect(screen.getByRole('radio', { name: he.listings.type.apartment })).toBeChecked();
    expect(screen.queryByRole('button', { name: he.common.back })).toBeNull();
    // And forward again: still there.
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    at(4);
    expect(household(p.household.family)).not.toBeChecked();
    expect(minContract()).toHaveValue('36');
    view.unmount();
    vi.unstubAllGlobals();

    // Edit mode opens on details, shown as step 1 of 4, with no back button: the type step is
    // unreachable (spec 0010a).
    const a = listing();
    mockApi({
      'GET /me': [() => json(owner)],
      'GET /areas': [() => json([gushDan])],
      'GET /me/listings': [() => json([a]), () => deferred().promise],
    });
    renderRoutes(`/me/listings/${a.id}/edit`, routes, testQueryClient());
    expect(
      await screen.findByRole('heading', { level: 1, name: he.listings.edit.title }),
    ).toBeVisible();
    await areasLoaded();
    expectStep(1, 4);
    expect(screen.queryByText(s.type)).toBeNull();
    expect(screen.queryByRole('button', { name: he.common.back })).toBeNull();
    expect(screen.queryByRole('radio', { name: he.listings.type.apartment })).toBeNull();
  });

  it('ac3_chosen_preferences_sent', async () => {
    const post = deferred();
    const api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [post.promise],
      'GET /me/listings': [json([])],
    });
    await toPreferences();

    for (const name of ALL_HOUSEHOLDS) fireEvent.click(household(name));
    for (const name of ALL_HOUSEHOLDS) expect(household(name)).not.toBeChecked();
    // Checked out of order on purpose: the body is in canonical order.
    fireEvent.click(household(p.household.couple));
    fireEvent.click(household(p.household.single));
    fireEvent.click(noSmokers());
    expect(noSmokers()).toBeChecked();
    fireEvent.change(minContract(), { target: { value: '12' } });
    expect(minContract()).toHaveDisplayValue(p.contract['12']);
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '5');

    // The preview: the three chips under the card.
    const card = screen.getByRole('article');
    const region = screen.getByRole('region', { name: he.listing.ownerLooksFor.title });
    expect(card.compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card).not.toContainElement(region);
    expect(
      within(region)
        .getAllByRole('listitem')
        .map((chip) => chip.textContent),
    ).toEqual(['יחיד/ה או זוג', 'ללא מעשנים', 'חוזה לשנה לפחות']);

    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(api.calls('POST /listings')).toHaveLength(1);
    });
    expect(api.calls('POST /listings')[0]?.body).toEqual({
      ...expectedBody,
      accepted_households: ['single', 'couple'],
      smoking_allowed: false,
      min_contract_months: 12,
    });
    post.resolve(json(listing(), 201));
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
  });

  it('ac4_households_required', async () => {
    const api = mockApi({ 'GET /areas': [json([gushDan])], 'POST /listings': [] });
    await toPreferences();
    expect(households()).toHaveAttribute('aria-invalid', 'false');

    for (const name of ALL_HOUSEHOLDS) fireEvent.click(household(name));
    // A new error waits for "next".
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(nextButton());

    expect(progress()).toHaveAttribute('aria-valuenow', '4');
    expect(errorFor(households())).toHaveTextContent(he.listings.errors.households);
    expect(document.activeElement).toBe(household(p.household.single));

    // A round trip to details (with a blur there) keeps it.
    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    expect(progress()).toHaveAttribute('aria-valuenow', '2');
    act(() => {
      screen.getByLabelText(he.listings.fields.city).focus();
      screen.getByLabelText(he.listings.fields.street).focus();
    });
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '4');
    expect(errorFor(households())).toHaveTextContent(he.listings.errors.households);

    // Another preference changing keeps the error; a household fixes it.
    fireEvent.click(noSmokers());
    expect(errorFor(households())).toHaveTextContent(he.listings.errors.households);
    fireEvent.change(minContract(), { target: { value: '6' } });
    expect(errorFor(households())).toHaveTextContent(he.listings.errors.households);
    fireEvent.click(household(p.household.family));
    expect(households()).toHaveAttribute('aria-invalid', 'false');
    expect(households()).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(he.listings.errors.households)).toBeNull();

    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '5');
    expect(api.calls('POST /listings')).toHaveLength(0);
  });

  it('ac5_server_error_on_preference_returns_to_step_3', async () => {
    // The preferences are step 4 since spec 0010e; the name keeps the AC's.
    const invalid = (...fields: string[]) =>
      json({ detail: fields.map((f) => ({ loc: ['body', f], msg: 'bad', type: 'x' })) }, 422);

    // The minimum contract named: back on the preferences, the error on the select and focus
    // there.
    mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [invalid('min_contract_months')],
    });
    let view = await toPreview();
    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(progress()).toHaveAttribute('aria-valuenow', '4');
    });
    expect(errorFor(minContract())).toHaveTextContent(he.listings.errors.invalid);
    expect(document.activeElement).toBe(minContract());
    expect(screen.queryByText('bad')).toBeNull();
    // Changing it clears the error.
    fireEvent.change(minContract(), { target: { value: '24' } });
    expect(minContract()).not.toHaveAttribute('aria-invalid', 'true');
    view.unmount();
    vi.unstubAllGlobals();

    // A details field and the households named: details first (step 2), the households' error
    // waiting on the preferences.
    mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [invalid('accepted_households', 'city')],
    });
    view = await toPreview();
    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(progress()).toHaveAttribute('aria-valuenow', '2');
    });
    const city = screen.getByLabelText(he.listings.fields.city);
    expect(errorFor(city)).toHaveTextContent(he.listings.errors.invalid);
    expect(document.activeElement).toBe(city);
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '4');
    expect(errorFor(households())).toHaveTextContent(he.listings.errors.invalid);
    view.unmount();
  });

  it('ac10_type_param_skips_type_step', async () => {
    const backButton = () => screen.queryByRole('button', { name: he.common.back });
    const room = withoutCounts(listing({ listing_type: 'room', flatmates_count: 2 }));
    const newRoutes = (
      <Routes>
        <Route path="/listings/new" element={<NewListingPage />} />
        <Route path="/me/listings" element={<StatePrinter />} />
        <Route path="/market/mine" element={<MarketMinePage />} />
      </Routes>
    );

    // `?type=room`: the room details first, "1 of 4", no back button there.
    let api = mockApi({
      'GET /me': [json(owner)],
      'GET /areas': [json([gushDan])],
      'POST /listings': [json(room, 201)],
      'GET /me/listings': [json([{ ...room, applicant_count: 0 }])],
      'GET /me/conversations': [json([])],
    });
    let view = renderRoutes('/listings/new?type=room', newRoutes, meClient());
    expect(h2(l.stepTitle.detailsRoom)).toBeVisible();
    expectStep(1, 4);
    expect(screen.queryByText(l.steps.type)).toBeNull();
    expect(backButton()).toBeNull();
    await areasLoaded();
    fillValidDetails('room');
    fireEvent.click(nextButton());
    expectStep(2, 4);
    expect(h2(l.stepTitle.photosRoom)).toBeVisible();
    expect(backButton()).toBeVisible();
    fireEvent.click(nextButton());
    expectStep(3, 4);
    expect(h2(p.titleRoom)).toBeVisible();
    fireEvent.change(screen.getByLabelText(l.room.flatmatesCount), { target: { value: '2' } });
    fireEvent.click(nextButton());
    expectStep(4, 4);
    fireEvent.click(publishButton());
    // Published: the market's "שלי", with the celebration.
    expect(await screen.findByText(l.mine.published)).toBeVisible();
    expect(currentPath()).toBe('/market/mine');
    expect(api.calls('POST /listings')[0]?.body).toMatchObject({
      listing_type: 'room',
      flatmates_count: 2,
    });
    view.unmount();
    vi.unstubAllGlobals();

    // `?type=apartment`: the apartment details first; published to "my listings".
    api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json(withoutCounts(listing()), 201)],
    });
    view = renderRoutes('/listings/new?type=apartment', newRoutes, meClient());
    expect(h2(l.stepTitle.details)).toBeVisible();
    expectStep(1, 4);
    expect(backButton()).toBeNull();
    await areasLoaded();
    fillValidDetails();
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    fireEvent.click(publishButton());
    expect(await screen.findByTestId('state')).toHaveTextContent(
      '{"published":true,"photosFailed":0}',
    );
    expect(currentPath()).toBe('/me/listings');
    expect(api.calls('POST /listings')[0]?.body).toMatchObject({ listing_type: 'apartment' });
    view.unmount();
    vi.unstubAllGlobals();

    // Anything else, or no param: the type step, "1 of 5".
    for (const path of ['/listings/new?type=house', '/listings/new']) {
      mockApi({ 'GET /areas': [json([gushDan])] });
      view = renderRoutes(path, newRoutes, meClient());
      expect(h2(l.stepTitle.type)).toBeVisible();
      expectStep(1, 5);
      expect(screen.getByRole('radio', { name: l.type.room })).not.toBeChecked();
      expect(screen.getByRole('radio', { name: l.type.apartment })).not.toBeChecked();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac10_non_owner_room_only', async () => {
    // Spec 0010b: only an owner posts an apartment. A seeker gets the room flow whatever `?type=`
    // says: no type step, the room details first, "1 of 4", published as a room to "שלי".
    const room = withoutCounts(listing({ listing_type: 'room', flatmates_count: 2 }));
    const newRoutes = (
      <Routes>
        <Route path="/listings/new" element={<NewListingPage />} />
        <Route path="/me/listings" element={<StatePrinter />} />
        <Route path="/market/mine" element={<p>mine</p>} />
      </Routes>
    );
    for (const path of ['/listings/new?type=apartment', '/listings/new', '/listings/new?type=x']) {
      const api = mockApi({
        'GET /areas': [json([gushDan])],
        'POST /listings': [json(room, 201)],
      });
      const view = renderRoutes(path, newRoutes, meClient(seeker));
      expect(h2(l.stepTitle.detailsRoom)).toBeVisible();
      expectStep(1, 4);
      expect(screen.queryByText(l.steps.type)).toBeNull();
      expect(screen.queryByRole('radio', { name: l.type.apartment })).toBeNull();
      await areasLoaded();
      fillValidDetails('room');
      fireEvent.click(nextButton());
      fireEvent.click(nextButton());
      fireEvent.change(screen.getByLabelText(l.room.flatmatesCount), { target: { value: '2' } });
      fireEvent.click(nextButton());
      fireEvent.click(publishButton());
      expect(await screen.findByText('mine')).toBeVisible();
      expect(currentPath()).toBe('/market/mine');
      expect(api.calls('POST /listings')[0]?.body).toMatchObject({ listing_type: 'room' });
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
});

describe('ListingWizard photos (spec 0010e)', () => {
  const createObjectURL = vi.fn<(file: Blob) => string>();
  const revokeObjectURL = vi.fn<(url: string) => void>();

  // jsdom has no object URLs.
  beforeEach(() => {
    let n = 0;
    createObjectURL.mockImplementation(() => {
      n += 1;
      return `blob:wizard-${String(n)}`;
    });
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
  });

  afterEach(() => {
    createObjectURL.mockReset();
    revokeObjectURL.mockReset();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  const ph = l.photos;
  const out = (id: string): PhotoOut => ({
    id,
    small_url: `https://media.example.test/${id}-s.webp`,
    large_url: `https://media.example.test/${id}-l.webp`,
  });
  /** A file whose body is `size` real bytes. */
  const file = (name: string, size = 4, type = 'image/jpeg') =>
    new File([new Uint8Array(size)], name, { type });
  const pick = (...files: File[]) => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input as HTMLInputElement, { target: { files } });
  };
  const tileSources = () =>
    Array.from(document.querySelectorAll('li[data-photo] img')).map((img) =>
      img.getAttribute('src'),
    );
  const coverOf = (card: HTMLElement) => card.querySelector('img')?.getAttribute('src');
  const backButton = () => screen.getByRole('button', { name: he.common.back });
  /** Every non-GET request, in the order sent. */
  const writes = (api: ReturnType<typeof mockApi>) =>
    api.fetchMock.mock.calls
      .map(([request]) => `${request.method} ${new URL(request.url).pathname}`)
      .filter((route) => !route.startsWith('GET '));
  const newRoutes = (
    <Routes>
      <Route path="/listings/new" element={<NewListingPage />} />
      <Route path="/me/listings" element={<StatePrinter />} />
    </Routes>
  );

  /** A new apartment, its details filled, on the photos step. */
  async function newToPhotos(client = meClient(), tree = newRoutes) {
    const view = renderRoutes('/listings/new', tree, client);
    chooseApartmentAndContinue();
    await areasLoaded();
    fillValidDetails();
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
    return view;
  }

  /** From the photos step to the preview, then publish. */
  function publishFromPhotos() {
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '5');
    fireEvent.click(publishButton());
  }

  it('ac2_publish_then_upload', async () => {
    const created = withoutCounts(listing());
    const upload = `POST /listings/${created.id}/photos`;
    const post = deferred();
    const first = deferred();
    const api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [post.promise],
      [upload]: [first.promise, json(out('d0000000-0000-0000-0000-0000000000d2'), 201)],
    });
    await newToPhotos();
    pick(file('one.jpg', 5, 'image/jpeg'), file('two.png', 7, 'image/png'));
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());

    // The preview card shows the first photo as the cover.
    expect(coverOf(screen.getByRole('article'))).toBe('blob:wizard-1');

    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(api.calls('POST /listings')).toHaveLength(1);
    });
    // Nothing is uploaded before the listing exists.
    expect(api.calls(upload)).toHaveLength(0);
    post.resolve(json(created, 201));

    // The first upload in flight: the button stays disabled and busy, with the progress line.
    await vi.waitFor(() => {
      expect(api.calls(upload)).toHaveLength(1);
    });
    expect(publishButton()).toBeDisabled();
    expect(publishButton()).toHaveAttribute('aria-busy', 'true');
    expect(backButton()).toBeDisabled();
    const line = screen.getByText('מעלים תמונה 1 מתוך 2…');
    expect(line).toHaveAttribute('role', 'status');
    expect(line).toHaveTextContent(i18n.t('listings.photos.uploading', { done: 1, total: 2 }));
    first.resolve(json(out('d0000000-0000-0000-0000-0000000000d1'), 201));

    expect(await screen.findByTestId('state')).toHaveTextContent(
      '{"published":true,"photosFailed":0}',
    );
    // One after the other, after the POST, each body the file itself with its type.
    expect(writes(api)).toEqual(['POST /listings', upload, upload]);
    const [one, two] = api.calls(upload);
    expect((await one?.request.arrayBuffer())?.byteLength).toBe(5);
    expect(one?.request.headers.get('Content-Type')).toBe('image/jpeg');
    expect((await two?.request.arrayBuffer())?.byteLength).toBe(7);
    expect(two?.request.headers.get('Content-Type')).toBe('image/png');
    // The wizard is gone: its object URLs too.
    expect(revokeObjectURL.mock.calls.map(([url]) => url).sort()).toEqual([
      'blob:wizard-1',
      'blob:wizard-2',
    ]);
  });

  it('ac2_back_disabled_while_the_post_is_pending', async () => {
    // "Back" during the POST would reset the mutation and drop its `onSuccess`: the listing would
    // exist and its photos never upload.
    const created = withoutCounts(listing());
    const upload = `POST /listings/${created.id}/photos`;
    const post = deferred();
    const api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [post.promise],
      [upload]: [json(out('d0000000-0000-0000-0000-0000000000d1'), 201)],
    });
    await newToPhotos();
    pick(file('one.jpg'));
    publishFromPhotos();
    await vi.waitFor(() => {
      expect(api.calls('POST /listings')).toHaveLength(1);
    });
    expect(backButton()).toBeDisabled();
    fireEvent.click(backButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '5');
    post.resolve(json(created, 201));
    expect(await screen.findByTestId('state')).toHaveTextContent(
      '{"published":true,"photosFailed":0}',
    );
    expect(writes(api)).toEqual(['POST /listings', upload]);
  });

  it('ac2_leaving_mid_sync_does_not_navigate', async () => {
    const created = withoutCounts(listing());
    const upload = `POST /listings/${created.id}/photos`;
    const first = deferred();
    const api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json(created, 201)],
      [upload]: [first.promise],
    });
    await newToPhotos(
      meClient(),
      <>
        <Link to="/elsewhere">away</Link>
        <Routes>
          <Route path="/listings/new" element={<NewListingPage />} />
          <Route path="/me/listings" element={<StatePrinter />} />
          <Route path="/elsewhere" element={<p>elsewhere</p>} />
        </Routes>
      </>,
    );
    pick(file('one.jpg'));
    publishFromPhotos();
    await vi.waitFor(() => {
      expect(api.calls(upload)).toHaveLength(1);
    });
    // While it uploads, closing the tab asks first.
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    // The lister leaves through a header link; the upload ends later.
    fireEvent.click(screen.getByRole('link', { name: 'away' }));
    expect(await screen.findByText('elsewhere')).toBeVisible();
    first.resolve(json(out('d0000000-0000-0000-0000-0000000000d1'), 201));
    // Let the sync finish (its last request answered, the invalidations sent).
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(currentPath()).toBe('/elsewhere');
    expect(screen.queryByTestId('state')).toBeNull();
    // Nothing guards the tab any more.
    const later = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);
  });

  it('ac3_partial_upload_failure', async () => {
    const created = withoutCounts(listing());
    const upload = `POST /listings/${created.id}/photos`;
    const one = out('d0000000-0000-0000-0000-0000000000d1');
    const three = out('d0000000-0000-0000-0000-0000000000d3');
    let api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json(created, 201)],
      [upload]: [
        json(one, 201),
        json({ detail: 'photo_storage_unavailable' }, 503),
        json(three, 201),
      ],
      'GET /me/listings': [
        json([
          {
            ...listing({ id: created.id, street: created.street }),
            photos: [one, three],
          },
        ]),
      ],
    });
    let view = await newToPhotos(meClient(), routes);
    pick(file('one.jpg'), file('two.jpg'), file('three.jpg'));
    publishFromPhotos();

    // The second failed, the third still went, and no reorder (the server order is right).
    expect(await screen.findByText(l.mine.published)).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'תמונה אחת לא הועלתה. אפשר להוסיף אותה שוב בעריכה.',
    );
    expect(currentPath()).toBe('/me/listings');
    expect(writes(api)).toEqual(['POST /listings', upload, upload, upload]);
    view.unmount();
    vi.unstubAllGlobals();

    // A POST that fails uploads nothing.
    api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json({ detail: 'listing_cap_reached' }, 409)],
    });
    view = await newToPhotos();
    pick(file('one.jpg'));
    publishFromPhotos();
    expect(await screen.findByText(i18n.t('listings.errors.capReached', { cap: 3 }))).toBeVisible();
    expect(writes(api)).toEqual(['POST /listings']);
    view.unmount();
    vi.unstubAllGlobals();

    // A 401 on an upload: the cached user is cleared (the app sends the lister to log in), no
    // navigation, nothing more is sent.
    const client = meClient();
    api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json(created, 201)],
      [upload]: [json({ detail: 'unauthenticated' }, 401)],
    });
    await newToPhotos(client);
    pick(file('one.jpg'), file('two.jpg'));
    publishFromPhotos();
    await vi.waitFor(() => {
      expect(client.getQueryData(ME_KEY)).toBeNull();
    });
    expect(currentPath()).toBe('/listings/new');
    expect(writes(api)).toEqual(['POST /listings', upload]);
  });

  it('ac4_edit_photo_sync', async () => {
    const [A, B, C] = [
      out('a0000000-0000-0000-0000-00000000000a'),
      out('b0000000-0000-0000-0000-00000000000b'),
      out('c0000000-0000-0000-0000-00000000000c'),
    ];
    const D = out('d0000000-0000-0000-0000-00000000000d');
    const stored = listing({ photos: [A, B, C] });
    const base = `/listings/${stored.id}/photos`;
    const editRoutes = (
      <Routes>
        <Route path="/me/listings/:id/edit" element={<EditListingPage />} />
        <Route path="/me/listings" element={<StatePrinter />} />
      </Routes>
    );
    const open = async (replies: Parameters<typeof mockApi>[0] = {}) => {
      const api = mockApi({
        'GET /me': [() => json(owner)],
        'GET /areas': [() => json([gushDan])],
        'GET /me/listings': [() => json([stored]), () => deferred().promise],
        ...replies,
      });
      const view = renderRoutes(`/me/listings/${stored.id}/edit`, editRoutes);
      expect(await screen.findByRole('heading', { level: 1, name: l.edit.title })).toBeVisible();
      await areasLoaded();
      return { api, view };
    };

    const { api, view } = await open({
      [`DELETE ${base}/${B.id}`]: [empty()],
      [`POST ${base}`]: [json(D, 201)],
      [`PUT ${base}/order`]: [json([D, A, C])],
    });
    // The photos step starts from the stored photos.
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '2');
    expect(tileSources()).toEqual([A.small_url, B.small_url, C.small_url]);

    // Remove B (a stored photo: no object URL to revoke), add D, move D first.
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('listings.photos.remove', { n: 2 }) }),
    );
    expect(revokeObjectURL).not.toHaveBeenCalled();
    pick(file('d.jpg'));
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('listings.photos.moveEarlier', { n: 3 }) }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('listings.photos.moveEarlier', { n: 2 }) }),
    );
    expect(tileSources()).toEqual(['blob:wizard-1', A.small_url, C.small_url]);

    // Unsaved photo changes: the back link asks first.
    fireEvent.click(screen.getByRole('link', { name: l.edit.backToMine }));
    const dialog = await screen.findByRole('dialog', { name: l.edit.leaveConfirm });
    fireEvent.click(within(dialog).getByRole('button', { name: l.edit.stay }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(currentPath()).toBe(`/me/listings/${stored.id}/edit`);

    // No field changed: no PATCH; B deleted, D uploaded, one reorder with [D, A, C].
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    expect(coverOf(screen.getByRole('article'))).toBe('blob:wizard-1');
    fireEvent.click(screen.getByRole('button', { name: l.save }));
    expect(await screen.findByTestId('state')).toHaveTextContent('{"saved":true,"photosFailed":0}');
    expect(writes(api)).toEqual([`DELETE ${base}/${B.id}`, `POST ${base}`, `PUT ${base}/order`]);
    expect(api.calls(`PUT ${base}/order`)[0]?.body).toEqual({ photo_ids: [D.id, A.id, C.id] });
    view.unmount();
    vi.unstubAllGlobals();

    // No change at all: nothing is sent, and "my listings" gets no message.
    const quiet = await open();
    fireEvent.click(nextButton());
    expect(tileSources()).toEqual([A.small_url, B.small_url, C.small_url]);
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    fireEvent.click(screen.getByRole('button', { name: l.save }));
    expect(await screen.findByTestId('state')).toHaveTextContent('null');
    expect(writes(quiet.api)).toEqual([]);
  });

  it('ac5_step_list', async () => {
    const s = l.steps;
    const names = () =>
      within(stepper())
        .getAllByRole('listitem')
        .map((item) => item.textContent?.replace(/^\d/, ''));

    // `?type=room`: four steps, the photos second ("שלב 2 מתוך 4" on it).
    const api = mockApi({ 'GET /areas': [json([gushDan])], 'POST /listings': [] });
    let view = renderRoutes('/listings/new?type=room', newRoutes, meClient());
    expect(names()).toEqual([s.details, s.photos, s.preferences, s.preview]);
    await areasLoaded();
    fillValidDetails('room');
    fireEvent.click(nextButton());
    expectStep(2, 4);
    expect(stepItem(s.photos)).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('שלב 2 מתוך 4')).toBeVisible();
    expect(h2(l.stepTitle.photosRoom)).toBeVisible();
    expect(screen.getByText(ph.hint)).toBeVisible();
    // "Next" on the photos step goes to the preferences and never publishes.
    fireEvent.click(nextButton());
    expectStep(3, 4);
    expect(h2(p.titleRoom)).toBeVisible();
    expect(api.calls('POST /listings')).toHaveLength(0);
    view.unmount();
    vi.unstubAllGlobals();

    // No type: five steps.
    mockApi({ 'GET /areas': [json([gushDan])] });
    view = renderWizard();
    expect(names()).toEqual([s.type, s.details, s.photos, s.preferences, s.preview]);
    expectStep(1, 5);
    view.unmount();
    vi.unstubAllGlobals();

    // Edit: from details, "1 of 4".
    mockApi({ 'GET /areas': [json([gushDan])] });
    view = renderRoutes(
      '/edit',
      <Routes>
        <Route path="/edit" element={<ListingWizard listing={listing()} />} />
      </Routes>,
    );
    expect(names()).toEqual([s.details, s.photos, s.preferences, s.preview]);
    expectStep(1, 4);
    expect(screen.getByText('שלב 1 מתוך 4')).toBeVisible();
    view.unmount();
    vi.unstubAllGlobals();

    // A 422 naming a preference still lands on the preferences (step 4 of 5).
    mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [
        json({ detail: [{ loc: ['body', 'min_contract_months'], msg: 'bad', type: 'x' }] }, 422),
      ],
    });
    await toPreview();
    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(progress()).toHaveAttribute('aria-valuenow', '4');
    });
    expectStep(4);
    expect(h2(p.title)).toBeVisible();
  });
});
