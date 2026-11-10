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
import type { ListingOut } from '../api';
import { formatIls } from '../format';
import { MY_LISTINGS_KEY } from '../useMyListings';
import { gushDan, listing, owner } from './fixtures';
import {
  areasLoaded,
  change,
  errorFor,
  field,
  IN_30_DAYS,
  nextButton,
  progress,
  routes,
} from './wizard';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const f = he.listings.fields;
const editPath = (id: string) => `/me/listings/${id}/edit`;
const renderEdit = (id: string, client = testQueryClient()) =>
  renderRoutes(editPath(id), routes, client);
const saveButton = () => screen.getByRole('button', { name: he.listings.save });
const stepItem = (name: string) => screen.getByText(name).closest('li') as HTMLElement;
const title = () => screen.getByRole('heading', { level: 1, name: he.listings.edit.title });
const backLink = () => screen.getByRole('link', { name: he.listings.edit.backToMine });
/** A reply that never arrives (a refetch left in flight). */
const never = () => deferred().promise;

/** The AC3 listing. */
const stored = (overrides: Partial<ListingOut> = {}) =>
  listing({
    rooms: 3.5,
    floor: 3,
    total_floors: 5,
    size_sqm: 95,
    price_ils: 7200,
    available_from: IN_30_DAYS,
    elevator: true,
    parking_spots: 1,
    furnished: 'partial',
    pets_allowed: true,
    arnona_ils: 480,
    vaad_ils: null,
    description: 'שורה\nשנייה',
    ...overrides,
  });

/** Opens the edit page for `a` (the list answers `[a]`, later refetches never answer). */
async function openEdit(a: ListingOut, patchReplies: Parameters<typeof mockApi>[0][string] = []) {
  const api = mockApi({
    'GET /me': [() => json(owner)],
    'GET /areas': [() => json([gushDan])],
    'GET /me/listings': [() => json([a]), never],
    [`PATCH /listings/${a.id}`]: patchReplies,
  });
  const client = testQueryClient();
  const view = renderEdit(a.id, client);
  expect(
    await screen.findByRole('heading', { level: 1, name: he.listings.edit.title }),
  ).toBeVisible();
  await areasLoaded();
  return { api, client, view };
}

/** Changes the price, goes to the preview and saves. */
async function changePriceAndSave(
  a: ListingOut,
  patchReplies: Parameters<typeof mockApi>[0][string],
) {
  const opened = await openEdit(a, patchReplies);
  change(f.price, '7500');
  fireEvent.click(nextButton());
  expect(progress()).toHaveAttribute('aria-valuenow', '3');
  fireEvent.click(saveButton());
  await vi.waitFor(() => {
    expect(opened.api.calls(`PATCH /listings/${a.id}`)).toHaveLength(1);
  });
  return opened;
}

const beforeUnloadPrevented = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('EditListingPage', () => {
  it('ac2_loads_from_my_listings_and_not_found', async () => {
    const a = stored();

    // Pending: one busy skeleton.
    mockApi({ 'GET /me/listings': [never], 'GET /areas': [() => json([gushDan])] });
    let view = renderEdit(a.id);
    const busy = screen.getByLabelText(he.common.loading);
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy).getAllByTestId('skeleton')).toHaveLength(1);
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // Failure: ErrorState; retry refetches the list.
    let api = mockApi({
      'GET /me/listings': [json({ detail: 'boom' }, 500), () => json([a])],
      'GET /areas': [() => json([gushDan])],
    });
    view = renderEdit(a.id);
    const retry = await screen.findByRole('button', { name: he.common.retry });
    expect(screen.getByRole('alert')).toHaveTextContent(he.common.error);
    fireEvent.click(retry);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.listings.edit.title }),
    ).toBeVisible();
    expect(api.calls('GET /me/listings')).toHaveLength(2);
    view.unmount();
    vi.unstubAllGlobals();

    // Another owner's id, an unknown uuid and a malformed id: "not found", no request for it.
    const other = listing({ owner_id: '00000000-0000-0000-0000-0000000000bb' });
    for (const id of [other.id, crypto.randomUUID(), 'abc']) {
      api = mockApi({
        'GET /me/listings': [() => json([a])],
        'GET /areas': [() => json([gushDan])],
      });
      view = renderEdit(id);
      expect(
        await screen.findByRole('heading', { level: 1, name: he.listings.edit.notFound }),
      ).toBeVisible();
      expect(backLink()).toHaveAttribute('href', '/me/listings');
      expect(screen.queryByRole('form')).toBeNull();
      const routesCalled = api.fetchMock.mock.calls.map(([request]) => {
        const r = request as Request;
        return `${r.method} ${new URL(r.url).pathname}`;
      });
      expect(routesCalled.filter((r) => r.startsWith('PATCH '))).toEqual([]);
      expect(routesCalled.filter((r) => r.startsWith('GET /listings/'))).toEqual([]);
      view.unmount();
      vi.unstubAllGlobals();
    }

    // A cached list renders the form at once; a background refetch (another tab changed the
    // street and the price) neither overwrites the typed price nor joins the PATCH body.
    const refetch = deferred();
    api = mockApi({
      'GET /me/listings': [refetch.promise, never],
      'GET /areas': [() => json([gushDan])],
      [`PATCH /listings/${a.id}`]: [() => json({ ...a, price_ils: 7500 })],
    });
    const client = testQueryClient();
    client.setQueryData<ListingOut[]>(MY_LISTINGS_KEY, [a]);
    view = renderEdit(a.id, client);
    expect(title()).toBeVisible();
    expect(screen.queryAllByTestId('skeleton')).toHaveLength(0);
    await areasLoaded();
    change(f.price, '7500');
    refetch.resolve(json([{ ...a, street: 'אחרת', price_ils: 9000 }]));
    await vi.waitFor(() => {
      expect(client.getQueryData<ListingOut[]>(MY_LISTINGS_KEY)?.[0]?.price_ils).toBe(9000);
    });
    expect(field(f.price)).toHaveValue(formatIls(7500));
    expect(field(f.street)).toHaveValue(a.street);
    fireEvent.click(nextButton());
    fireEvent.click(saveButton());
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    expect(api.calls(`PATCH /listings/${a.id}`).map((c) => c.body)).toStrictEqual([
      { price_ils: 7500 },
    ]);
  });

  it('ac3_prefilled_from_listing', async () => {
    const a = stored();
    const { view } = await openEdit(a);

    expect(stepItem(he.listings.steps.details)).toHaveAttribute('aria-current', 'step');
    expect(progress()).toHaveAttribute('aria-valuenow', '2');
    expect(field(f.area)).toHaveValue(gushDan.id);
    expect(field(f.city)).toHaveValue(a.city);
    expect(field(f.street)).toHaveValue(a.street);
    expect(field(f.rooms)).toHaveValue('3.5');
    expect(field(f.floor)).toHaveValue(3);
    expect(field(f.totalFloors)).toHaveValue(5);
    expect(field(f.size)).toHaveValue(95);
    expect(field(f.price)).toHaveValue('7,200');
    expect(field(f.availableFrom)).toHaveValue(IN_30_DAYS);
    expect(screen.getByRole('switch', { name: f.entryFlexible })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: f.elevator })).toBeChecked();
    expect(field(f.parking)).toHaveValue('1');
    expect(screen.getByRole('radio', { name: 'מרוהטת חלקית' })).toBeChecked();
    expect(screen.getByRole('switch', { name: f.pets })).toBeChecked();
    expect(field(f.arnona)).toHaveValue(480);
    expect(field(f.vaad)).toHaveValue(null);
    expect(field(f.description)).toHaveValue('שורה\nשנייה');

    // Step 1 is reachable: the stored type is chosen.
    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByRole('radio', { name: he.listings.type.apartment })).toBeChecked();
    view.unmount();
    vi.unstubAllGlobals();

    // 12 rooms (posted by API, outside the select's range) still shows.
    await openEdit(stored({ rooms: 12 }));
    expect(field(f.rooms)).toHaveValue('12');
    expect(field(f.rooms)).toHaveDisplayValue('12');
  });

  it('ac4_save_sends_only_changed_fields', async () => {
    const a = stored();
    const patch = deferred();
    const api = mockApi({
      'GET /areas': [() => json([gushDan])],
      'GET /me/listings': [() => json([a]), never],
      [`PATCH /listings/${a.id}`]: [patch.promise],
    });
    const client = testQueryClient();
    client.setQueryData(['listing', a.id], { id: a.id });
    renderEdit(a.id, client);
    await areasLoaded();
    change(f.price, '7500');
    change(f.arnona, '');
    fireEvent.click(nextButton());

    const card = screen.getByRole('article');
    expect(within(card).getByText(`${formatIls(7500)} ${he.listings.units.ils}`)).toBeVisible();

    // A same-tick double click sends one PATCH.
    act(() => {
      fireEvent.click(saveButton());
      fireEvent.click(saveButton());
    });
    await vi.waitFor(() => {
      expect(api.calls(`PATCH /listings/${a.id}`)).toHaveLength(1);
    });
    expect(saveButton()).toBeDisabled();
    expect(saveButton()).toHaveAttribute('aria-busy', 'true');
    const [call] = api.calls(`PATCH /listings/${a.id}`);
    expect(call?.body).toStrictEqual({ price_ils: 7500, arnona_ils: null });
    expect(call?.request.credentials).toBe('include');

    patch.resolve(json({ ...a, price_ils: 7500, arnona_ils: null }));
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    expect(screen.queryAllByTestId('skeleton')).toHaveLength(0);
    expect(screen.getByRole('article')).toHaveTextContent(formatIls(7500));
    expect(screen.getByText(he.listings.edit.saved)).toHaveAttribute('role', 'status');
    expect(client.getQueryState(['listing', a.id])?.isInvalidated).toBe(true);
    expect(api.calls(`PATCH /listings/${a.id}`)).toHaveLength(1);
  });

  it('ac4_unchanged_form_saves_nothing', async () => {
    const a = stored();
    const { api } = await openEdit(a);
    fireEvent.click(nextButton());
    fireEvent.click(saveButton());
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    expect(api.calls(`PATCH /listings/${a.id}`)).toHaveLength(0);
    expect(screen.queryByText(he.listings.edit.saved)).toBeNull();
  });

  it('ac5_reuses_wizard_validation', async () => {
    const a = stored();
    const { api } = await openEdit(a);
    change(f.city, '');
    change(f.price, '100');
    fireEvent.click(nextButton());

    expect(errorFor(field(f.city))).toHaveTextContent(he.listings.errors.required);
    expect(errorFor(field(f.price))).toHaveTextContent(
      i18n.t('listings.errors.range', { min: 500, max: 100000 }),
    );
    expect(document.activeElement).toBe(field(f.city));
    expect(progress()).toHaveAttribute('aria-valuenow', '2');
    expect(api.calls(`PATCH /listings/${a.id}`)).toHaveLength(0);
  });

  it('ac6_save_errors', async () => {
    const msg = 'city has too many combining marks in a row';

    // 422 naming city: back on step 2, the error on city, focus there, the English msg nowhere.
    let a = stored();
    let opened = await changePriceAndSave(a, [
      json({ detail: [{ loc: ['body', 'city'], type: 'value_error', msg }] }, 422),
    ]);
    await vi.waitFor(() => {
      expect(progress()).toHaveAttribute('aria-valuenow', '2');
    });
    const city = field(f.city);
    expect(errorFor(city)).toHaveTextContent(he.listings.errors.invalid);
    expect(document.activeElement).toBe(city);
    expect(document.body.textContent).not.toContain(msg);
    // A blur out of city and a change of street keep it; a change of city clears it.
    act(() => {
      field(f.street).focus();
    });
    expect(errorFor(field(f.city))).toHaveTextContent(he.listings.errors.invalid);
    change(f.street, `${a.street} 2`);
    expect(errorFor(field(f.city))).toHaveTextContent(he.listings.errors.invalid);
    change(f.city, 'גבעתיים');
    expect(field(f.city)).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText(he.listings.errors.invalid)).toBeNull();
    opened.view.unmount();
    vi.unstubAllGlobals();

    // A model-level 422: common.error on step 3, no retry.
    a = stored();
    opened = await changePriceAndSave(a, [
      json({ detail: [{ loc: ['body'], type: 'value_error', msg: 'bad row' }] }, 422),
    ]);
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    expect(document.body.textContent).not.toContain('bad row');
    opened.view.unmount();
    vi.unstubAllGlobals();

    // unknown_area: area inactive, with a way back.
    a = stored();
    opened = await changePriceAndSave(a, [json({ detail: 'unknown_area' }, 422)]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(he.listings.errors.areaInactive);
    fireEvent.click(within(alert).getByRole('button', { name: he.common.back }));
    expect(progress()).toHaveAttribute('aria-valuenow', '2');
    opened.view.unmount();
    vi.unstubAllGlobals();

    // 409: the cap message.
    a = stored();
    opened = await changePriceAndSave(a, [json({ detail: 'listing_cap_reached' }, 409)]);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('listings.errors.capReached', { cap: 3 }),
    );
    opened.view.unmount();
    vi.unstubAllGlobals();

    // 404: "not found" at once. The list's refetch never answers, so only the cache update
    // (removing A) can show it.
    a = stored();
    opened = await changePriceAndSave(a, [json({ detail: 'not_found' }, 404)]);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.listings.edit.notFound }),
    ).toBeVisible();
    expect(opened.client.getQueryData<ListingOut[]>(MY_LISTINGS_KEY)).toEqual([]);
    expect(opened.api.calls('GET /me/listings')).toHaveLength(2);
    expect(currentPath()).toBe(editPath(a.id));
    opened.view.unmount();
    vi.unstubAllGlobals();

    // 401 → /login; 403 → /.
    for (const [status, detail, target] of [
      [401, 'unauthenticated', '/login'],
      [403, 'owner_only', '/'],
    ] as const) {
      a = stored();
      opened = await changePriceAndSave(a, [json({ detail }, status)]);
      await vi.waitFor(() => {
        expect(currentPath()).toBe(target);
      });
      opened.view.unmount();
      vi.unstubAllGlobals();
    }

    // Network error: common.error + retry, which re-sends the identical body.
    a = stored();
    opened = await changePriceAndSave(a, [networkError, () => json({ ...a, price_ils: 7500 })]);
    const retry = await screen.findByRole('button', { name: he.common.retry });
    expect(screen.getByRole('alert')).toHaveTextContent(he.common.error);
    fireEvent.click(retry);
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    const bodies = opened.api.calls(`PATCH /listings/${a.id}`).map((c) => c.body);
    expect(bodies).toStrictEqual([{ price_ils: 7500 }, { price_ils: 7500 }]);
  });

  it('ac8_expired_listing_editable_with_hint', async () => {
    const hint = () => screen.queryByText(he.listings.edit.expiredHint);

    const a = stored({ status: 'active', expires_at: '2020-01-01T00:00:00Z' });
    const { api, view } = await openEdit(a, [() => json({ ...a, price_ils: 7500 })]);
    expect(hint()).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(hint()).toBeVisible();
    fireEvent.click(nextButton());
    change(f.price, '7500');
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
    expect(hint()).toBeVisible();
    fireEvent.click(saveButton());
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    expect(api.calls(`PATCH /listings/${a.id}`).map((c) => c.body)).toStrictEqual([
      { price_ils: 7500 },
    ]);
    view.unmount();
    vi.unstubAllGlobals();

    // Live and paused (even past its expiry): no hint.
    for (const other of [
      stored(),
      stored({ status: 'paused' }),
      stored({ status: 'paused', expires_at: '2020-01-01T00:00:00Z' }),
    ]) {
      const opened = await openEdit(other);
      expect(hint()).toBeNull();
      opened.view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac9_unsaved_changes_guard', async () => {
    const confirm = vi.spyOn(window, 'confirm');

    // Nothing changed: no prompt on unload, the link leaves without asking.
    let a = stored();
    let opened = await openEdit(a);
    expect(beforeUnloadPrevented()).toBe(false);
    fireEvent.click(backLink());
    expect(currentPath()).toBe('/me/listings');
    expect(confirm).not.toHaveBeenCalled();
    opened.view.unmount();
    vi.unstubAllGlobals();

    // A changed field: unload is prevented and the link asks; cancel stays with the value kept.
    a = stored();
    opened = await openEdit(a);
    change(f.price, '7500');
    expect(beforeUnloadPrevented()).toBe(true);
    confirm.mockReturnValueOnce(false);
    fireEvent.click(backLink());
    expect(confirm).toHaveBeenCalledWith(he.listings.edit.leaveConfirm);
    expect(currentPath()).toBe(editPath(a.id));
    expect(field(f.price)).toHaveValue(formatIls(7500));
    confirm.mockReturnValueOnce(true);
    fireEvent.click(backLink());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(currentPath()).toBe('/me/listings');
    expect(beforeUnloadPrevented()).toBe(false);
    opened.view.unmount();
    vi.unstubAllGlobals();

    // After a successful save no listener remains.
    a = stored();
    await changePriceAndSave(a, [() => json({ ...a, price_ils: 7500 })]);
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    expect(beforeUnloadPrevented()).toBe(false);
    vi.unstubAllGlobals();
    confirm.mockClear();

    // Areas still loading on an untouched form: not dirty (`withArea` would give `area_id: ''`).
    a = stored();
    const areas = deferred();
    mockApi({
      'GET /areas': [areas.promise],
      'GET /me/listings': [() => json([a]), never],
    });
    renderEdit(a.id);
    expect(
      await screen.findByRole('heading', { level: 1, name: he.listings.edit.title }),
    ).toBeVisible();
    expect(field(f.area)).toBeDisabled();
    expect(beforeUnloadPrevented()).toBe(false);
    fireEvent.click(backLink());
    expect(confirm).not.toHaveBeenCalled();
    expect(currentPath()).toBe('/me/listings');
  });
});
