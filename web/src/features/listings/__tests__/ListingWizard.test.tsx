import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import {
  currentPath,
  deferred,
  json,
  mockApi,
  networkError,
  testQueryClient,
} from '../../auth/__tests__/harness';
import type { ListingOut } from '../api';
import { MY_LISTINGS_KEY } from '../useMyListings';
import { gushDan, listing, owner } from './fixtures';
import {
  areasLoaded,
  chooseApartmentAndContinue,
  fillValidDetails,
  IN_30_DAYS,
  nextButton,
  progress,
  renderWizard,
} from './wizard';

afterEach(() => {
  vi.unstubAllGlobals();
});

const stepItem = (name: string) => screen.getByText(name).closest('li') as HTMLElement;
const publishButton = () => screen.getByRole('button', { name: he.listings.publish });

/** Renders the wizard, chooses apartment, fills the AC4 values and goes to the preview. */
async function toPreview(client = testQueryClient()) {
  const view = renderWizard(client);
  chooseApartmentAndContinue();
  await areasLoaded();
  fillValidDetails();
  fireEvent.click(nextButton());
  expect(progress()).toHaveAttribute('aria-valuenow', '3');
  return view;
}

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
};

describe('ListingWizard', () => {
  it('ac2_type_step_and_back_keeps_state', async () => {
    mockApi({ 'GET /areas': [json([gushDan])] });
    renderWizard();

    expect(screen.getByRole('heading', { level: 1, name: he.listings.new.title })).toBeVisible();
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(progress()).toHaveAttribute('aria-valuemax', '3');
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
    const created = listing({ ...expectedBody, listing_type: 'apartment', furnished: 'partial' });
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
    expect(api.calls('GET /me/listings')).toHaveLength(1);

    refetch.resolve(json([created, older]));
    await vi.waitFor(() => {
      expect(screen.getAllByRole('article')).toHaveLength(2);
    });
  });

  it('ac5_publish_errors', async () => {
    const alertText = () => screen.getByRole('alert').textContent;

    // 409: cap reached, still on step 3.
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
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
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
    fireEvent.click(within(alert).getByRole('button', { name: he.common.back }));
    expect(progress()).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByLabelText(he.listings.fields.city)).toHaveValue('גבעתיים');
    view.unmount();
    vi.unstubAllGlobals();

    // 422 with a list detail: common.error, no retry.
    mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [
        json({ detail: [{ loc: ['body', 'city'], msg: 'bad', type: 'value_error' }] }, 422),
      ],
    });
    view = await toPreview();
    fireEvent.click(publishButton());
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
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
});
