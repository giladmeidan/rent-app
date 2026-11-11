import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import {
  currentPath,
  deferred,
  json,
  mockApi,
  networkError,
  renderRoutes,
  testQueryClient,
} from '../../auth/__tests__/harness';
import type { GenderPreference, Household, ListingOut } from '../api';
import { MY_LISTINGS_KEY } from '../useMyListings';
import { gushDan, listing, owner, withoutCounts } from './fixtures';
import {
  areasLoaded,
  chooseApartmentAndContinue,
  errorFor,
  fillValidDetails,
  IN_30_DAYS,
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
  expect(progress()).toHaveAttribute('aria-valuenow', '4');
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
  city: 'גבעתיים',
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
};

describe('ListingWizard', () => {
  it('ac2_type_step_and_back_keeps_state', async () => {
    mockApi({ 'GET /areas': [json([gushDan])] });
    renderWizard();

    expect(screen.getByRole('heading', { level: 1, name: he.listings.new.title })).toBeVisible();
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(progress()).toHaveAttribute('aria-valuemax', '4');
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
        name: i18n.t('listings.card.title', { rooms: '3.5', street: 'כצנלסון', city: 'גבעתיים' }),
      }),
    ).toBeVisible();
    expect(within(card).getByText('7,200 ₪')).toBeVisible();
    expect(within(card).getByText(he.listings.units.perMonth)).toBeVisible();
    expect(
      within(card).getByText(i18n.t('listings.card.floorOf', { floor: 3, total: 5 })),
    ).toBeVisible();
    const chips = within(within(card).getByTestId('listing-chips')).getAllByRole('listitem');
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'מעלית',
      'חניה',
      'מרוהטת חלקית',
      'חיות מחמד',
    ]);

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
    expect(applicantsLink?.querySelector('span')).toBeNull();
    expect(api.calls('GET /me/listings')).toHaveLength(1);

    refetch.resolve(json([{ ...created, applicant_count: 0, new_applicant_count: 0 }, older]));
    await vi.waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(2);
    });
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
    expect(progress()).toHaveAttribute('aria-valuenow', '4');
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
    const names = [s.type, s.details, s.preferences, s.preview];

    const items = within(stepItem(s.type).closest('ol') as HTMLElement).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    items.forEach((item, i) => {
      expect(item).toHaveTextContent(names[i] as string);
    });
    expect(progress()).toHaveAttribute('aria-valuemin', '1');
    expect(progress()).toHaveAttribute('aria-valuemax', '4');
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
    at(4);
    expect(screen.getByRole('button', { name: he.listings.publish })).toBeVisible();

    // Back: preview → preferences → details → type, every value kept.
    const back = () => fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    back();
    at(3);
    expect(household(p.household.single)).toBeChecked();
    expect(household(p.household.family)).not.toBeChecked();
    expect(noSmokers()).toBeChecked();
    expect(minContract()).toHaveDisplayValue(p.contract['36']);
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
    at(3);
    expect(household(p.household.family)).not.toBeChecked();
    expect(minContract()).toHaveValue('36');
    view.unmount();
    vi.unstubAllGlobals();

    // Edit mode opens on details; back reaches type.
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
    at(2);
    expect(progress()).toHaveAttribute('aria-valuemax', '4');
    back();
    at(1);
    expect(screen.getByRole('radio', { name: he.listings.type.apartment })).toBeChecked();
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
    expect(progress()).toHaveAttribute('aria-valuenow', '4');

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

    expect(progress()).toHaveAttribute('aria-valuenow', '3');
    expect(errorFor(households())).toHaveTextContent(he.listings.errors.households);
    expect(document.activeElement).toBe(household(p.household.single));

    // A round trip to details (with a blur there) keeps it.
    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    expect(progress()).toHaveAttribute('aria-valuenow', '2');
    act(() => {
      screen.getByLabelText(he.listings.fields.city).focus();
      screen.getByLabelText(he.listings.fields.street).focus();
    });
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
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
    expect(progress()).toHaveAttribute('aria-valuenow', '4');
    expect(api.calls('POST /listings')).toHaveLength(0);
  });

  it('ac5_server_error_on_preference_returns_to_step_3', async () => {
    const invalid = (...fields: string[]) =>
      json({ detail: fields.map((f) => ({ loc: ['body', f], msg: 'bad', type: 'x' })) }, 422);

    // The minimum contract named: back on step 3, the error on the select and focus there.
    mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [invalid('min_contract_months')],
    });
    let view = await toPreview();
    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(progress()).toHaveAttribute('aria-valuenow', '3');
    });
    expect(errorFor(minContract())).toHaveTextContent(he.listings.errors.invalid);
    expect(document.activeElement).toBe(minContract());
    expect(screen.queryByText('bad')).toBeNull();
    // Changing it clears the error.
    fireEvent.change(minContract(), { target: { value: '24' } });
    expect(minContract()).toHaveAttribute('aria-invalid', 'false');
    view.unmount();
    vi.unstubAllGlobals();

    // A details field and the households named: details first (step 2), the households' error
    // waiting on step 3.
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
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
    expect(errorFor(households())).toHaveTextContent(he.listings.errors.invalid);
    view.unmount();
  });
});
