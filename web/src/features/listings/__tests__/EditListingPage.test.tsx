import { act, fireEvent, screen, within } from '@testing-library/react';
import { Link, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { RouteFocus } from '../../../app/RouteFocus';
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
import type { LifestyleKey } from '../../lifestyle/keys';
import type { ListingOut } from '../api';
import { EditListingPage } from '../EditListingPage';
import { formatDate, formatIls, todayInIsrael } from '../format';
import { MyListingsPage } from '../MyListingsPage';
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

const r = he.listings.room;
const g = he.rooms.genderPreference;
const genderRadio = (name: string) =>
  within(screen.getByRole('group', { name: r.genderPreference })).getByRole('radio', { name });
const flatmatesCount = () => field(r.flatmatesCount);
const ageSlot = (n: number) => field(r.ageOf.replace('{{n}}', String(n)));
/** The radio of one questionnaire answer, by the question's flat wording. */
const lifestyleRadio = (key: LifestyleKey, n: '1' | '2' | '3') => {
  const q = he.lifestyle[key];
  return within(screen.getByRole('group', { name: q.question.flat })).getByRole('radio', {
    name: q.answer[n],
  });
};

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

/** Changes the price, goes to the preview (through the photos and the preferences) and saves. */
async function changePriceAndSave(
  a: ListingOut,
  patchReplies: Parameters<typeof mockApi>[0][string],
) {
  const opened = await openEdit(a, patchReplies);
  change(f.price, '7500');
  fireEvent.click(nextButton());
  expect(progress()).toHaveAttribute('aria-valuenow', '2');
  fireEvent.click(nextButton());
  expect(progress()).toHaveAttribute('aria-valuenow', '3');
  fireEvent.click(nextButton());
  expect(progress()).toHaveAttribute('aria-valuenow', '4');
  fireEvent.click(saveButton());
  await vi.waitFor(() => {
    expect(opened.api.calls(`PATCH /listings/${a.id}`)).toHaveLength(1);
  });
  return opened;
}

/** From the preferences (shown step 3): on to the preview, save, back on "my listings"; the PATCH bodies sent. */
async function saveFromPreferences(api: ReturnType<typeof mockApi>, a: ListingOut) {
  fireEvent.click(nextButton());
  expect(progress()).toHaveAttribute('aria-valuenow', '4');
  fireEvent.click(saveButton());
  // A room's "my" page is the market's (spec 0010a).
  await vi.waitFor(() => {
    expect(currentPath()).toBe(a.listing_type === 'room' ? '/market/mine' : '/me/listings');
  });
  return api.calls(`PATCH /listings/${a.id}`).map((c) => c.body);
}

/** From details to the preferences, through the photos step (spec 0010e). */
function detailsToPreferences() {
  fireEvent.click(nextButton());
  expect(progress()).toHaveAttribute('aria-valuenow', '2');
  fireEvent.click(nextButton());
  expect(progress()).toHaveAttribute('aria-valuenow', '3');
}

const beforeUnloadPrevented = () => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
};

describe('EditListingPage', () => {
  it('ac2_loads_from_my_listings_and_not_found', async () => {
    const a = stored();

    // Pending: one busy skeleton, under the page's <h1>.
    mockApi({ 'GET /me/listings': [never], 'GET /areas': [() => json([gushDan])] });
    let view = renderEdit(a.id);
    const busy = screen.getByText(he.common.loading).closest<HTMLElement>('[aria-busy="true"]');
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(within(busy as HTMLElement).getAllByTestId('skeleton')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: he.listings.edit.title })).toBeVisible();
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
    // The error state keeps the page's <h1>: wait for the wizard's.
    await vi.waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
    expect(screen.getByRole('heading', { level: 1, name: he.listings.edit.title })).toBeVisible();
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
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    fireEvent.click(saveButton());
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    expect(api.calls(`PATCH /listings/${a.id}`).map((c) => c.body)).toStrictEqual([
      { price_ils: 7500 },
    ]);
    view.unmount();
    vi.unstubAllGlobals();

    // A cached list survives a background refetch that answers 500: the form stays and no
    // ErrorState shows (FOLLOWUPS 54).
    const failing = mockApi({
      'GET /me/listings': [json({ detail: 'boom' }, 500), never],
      'GET /areas': [() => json([gushDan])],
    });
    const cached = testQueryClient();
    cached.setQueryData<ListingOut[]>(MY_LISTINGS_KEY, [a]);
    view = renderEdit(a.id, cached);
    await areasLoaded();
    await vi.waitFor(() => {
      expect(failing.calls('GET /me/listings')).toHaveLength(1);
    });
    await vi.waitFor(() => {
      expect(cached.getQueryState(MY_LISTINGS_KEY)?.fetchStatus).toBe('idle');
    });
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(field(f.city)).toHaveValue(a.city);
    expect(cached.getQueryData<ListingOut[]>(MY_LISTINGS_KEY)).toHaveLength(1);
  });

  it('ac3_prefilled_from_listing', async () => {
    const a = stored();
    const { view } = await openEdit(a);

    expect(stepItem(he.listings.steps.details)).toHaveAttribute('aria-current', 'step');
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
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

    // No type step in edit mode (spec 0010a): details is step 1 of 4.
    expect(progress()).toHaveAttribute('aria-valuemax', '4');
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
    fireEvent.click(nextButton());
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
    // The line is filled a frame after "my listings" mounts (spec 0009t).
    expect(await screen.findByText(he.listings.edit.saved)).toHaveAttribute('role', 'status');
    expect(client.getQueryState(['listing', a.id])?.isInvalidated).toBe(true);
    expect(api.calls(`PATCH /listings/${a.id}`)).toHaveLength(1);
  });

  it('ac4_unchanged_form_saves_nothing', async () => {
    const a = stored();
    const { api } = await openEdit(a);
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
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
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
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
      expect(progress()).toHaveAttribute('aria-valuenow', '1');
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
    expect(field(f.city)).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(he.listings.errors.invalid)).toBeNull();
    opened.view.unmount();
    vi.unstubAllGlobals();

    // A model-level 422: common.error on step 4, no retry.
    a = stored();
    opened = await changePriceAndSave(a, [
      json({ detail: [{ loc: ['body'], type: 'value_error', msg: 'bad row' }] }, 422),
    ]);
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    expect(progress()).toHaveAttribute('aria-valuenow', '4');
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    expect(document.body.textContent).not.toContain('bad row');
    opened.view.unmount();
    vi.unstubAllGlobals();

    // unknown_area: area inactive, with a way back.
    a = stored();
    opened = await changePriceAndSave(a, [json({ detail: 'unknown_area' }, 422)]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(he.listings.errors.areaInactive);
    fireEvent.click(within(alert).getByRole('button', { name: he.listings.preview.backToDetails }));
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
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

  it('ac2_not_found_takes_focus', async () => {
    // An in-app navigation to an id not in my listings: the not-found <h1> takes focus after
    // RouteFocus has focused <main>.
    const a = stored();
    mockApi({
      'GET /me': [() => json(owner)],
      'GET /areas': [() => json([gushDan])],
      'GET /me/listings': [() => json([a])],
    });
    const client = testQueryClient();
    client.setQueryData(MY_LISTINGS_KEY, [a]);
    const view = renderRoutes(
      '/start',
      <main id="main" tabIndex={-1}>
        <RouteFocus />
        <Routes>
          <Route path="/start" element={<Link to={editPath('missing')}>go</Link>} />
          <Route path="/me/listings/:id/edit" element={<EditListingPage />} />
        </Routes>
      </main>,
      client,
    );
    fireEvent.click(screen.getByRole('link', { name: 'go' }));
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: he.listings.edit.notFound,
    });
    await vi.waitFor(() => {
      expect(heading).toHaveFocus();
    });
    view.unmount();
    vi.unstubAllGlobals();

    // A save answering PATCH 404: the wizard drops the listing, and the heading takes focus.
    const b = stored();
    const opened = await changePriceAndSave(b, [json({ detail: 'not_found' }, 404)]);
    const notFound = await screen.findByRole('heading', {
      level: 1,
      name: he.listings.edit.notFound,
    });
    await vi.waitFor(() => {
      expect(notFound).toHaveFocus();
    });
    opened.view.unmount();
  });

  it('ac2_past_expiry_listing_is_read_only', async () => {
    const past = '2020-01-01T00:00:00Z';
    for (const status of ['active', 'paused'] as const) {
      const a = stored({ status, expires_at: past });
      const api = mockApi({
        'GET /me': [() => json(owner)],
        'GET /me/listings': [() => json([a]), never],
        'GET /areas': [() => json([gushDan])],
        [`PATCH /listings/${a.id}`]: [() => json(a)],
      });
      const view = renderEdit(a.id);
      const heading = await screen.findByRole('heading', {
        level: 1,
        name: he.listings.edit.expiredTitle,
      });
      await vi.waitFor(() => {
        expect(heading).toHaveFocus();
      });
      expect(screen.getByText(he.listings.edit.expiredBody)).toBeVisible();
      expect(backLink()).toHaveAttribute('href', '/me/listings');
      for (const role of ['textbox', 'combobox', 'spinbutton']) {
        expect(screen.queryAllByRole(role)).toHaveLength(0);
      }
      expect(api.calls(`PATCH /listings/${a.id}`)).toHaveLength(0);
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac3_live_and_paused_before_expiry_still_editable', async () => {
    for (const other of [stored(), stored({ status: 'paused' })]) {
      const opened = await openEdit(other);
      expect(title()).toBeVisible();
      expect(screen.queryByText(he.listings.edit.expiredTitle)).toBeNull();
      expect(screen.queryByText(he.listings.edit.expiredBody)).toBeNull();
      opened.view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac9_unsaved_changes_guard', async () => {
    // The kit's dialog (`useConfirm`) asks, not the browser's `confirm`.
    const confirm = vi.spyOn(window, 'confirm');
    const leaveDialog = () => screen.queryByRole('dialog', { name: he.listings.edit.leaveConfirm });

    // Nothing changed: no prompt on unload, the link leaves without asking.
    let a = stored();
    let opened = await openEdit(a);
    expect(beforeUnloadPrevented()).toBe(false);
    fireEvent.click(backLink());
    expect(currentPath()).toBe('/me/listings');
    expect(leaveDialog()).toBeNull();
    opened.view.unmount();
    vi.unstubAllGlobals();

    // A changed field: unload is prevented and the link asks; "המשך עריכה" stays with the value
    // kept, a second click and "יציאה בלי שמירה" leave.
    a = stored();
    opened = await openEdit(a);
    change(f.price, '7500');
    expect(beforeUnloadPrevented()).toBe(true);
    fireEvent.click(backLink());
    const dialog = await screen.findByRole('dialog', { name: he.listings.edit.leaveConfirm });
    expect(currentPath()).toBe(editPath(a.id));
    fireEvent.click(within(dialog).getByRole('button', { name: he.listings.edit.stay }));
    await vi.waitFor(() => {
      expect(leaveDialog()).toBeNull();
    });
    expect(currentPath()).toBe(editPath(a.id));
    expect(field(f.price)).toHaveValue(formatIls(7500));
    fireEvent.click(backLink());
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: he.listings.edit.leaveConfirm })).getByRole(
        'button',
        { name: he.listings.edit.leave },
      ),
    );
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
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

    // Areas still loading on an untouched form: not dirty (`withArea` would give `area_id: ''`).
    a = stored();
    const areas = deferred();
    mockApi({
      'GET /areas': [areas.promise],
      'GET /me/listings': [() => json([a]), never],
    });
    renderEdit(a.id);
    // The loading state has the page's <h1> too: wait for the wizard's form.
    await vi.waitFor(() => {
      expect(field(f.area)).toBeDisabled();
    });
    expect(screen.getByRole('heading', { level: 1, name: he.listings.edit.title })).toBeVisible();
    expect(beforeUnloadPrevented()).toBe(false);
    fireEvent.click(backLink());
    expect(leaveDialog()).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    expect(currentPath()).toBe('/me/listings');
  });

  it('ac6_preferences_patch_only_changes', async () => {
    const p = he.listings.prefs;
    const household = (name: string) => screen.getByRole('checkbox', { name });
    const noSmokers = () => screen.getByRole('switch', { name: p.noSmokers });
    const minContract = () => field(p.minContract);
    // The households as the API may order them.
    const prefs = {
      accepted_households: ['couple', 'single'],
      smoking_allowed: true,
      min_contract_months: null,
    } as const satisfies Partial<ListingOut>;

    // Only the minimum changes: the PATCH carries it alone.
    let a = stored({ ...prefs, accepted_households: [...prefs.accepted_households] });
    let opened = await openEdit(a, [() => json({ ...a, min_contract_months: 24 })]);
    detailsToPreferences();
    expect(household(p.household.single)).toBeChecked();
    expect(household(p.household.couple)).toBeChecked();
    expect(household(p.household.family)).not.toBeChecked();
    expect(household(p.household.roommates)).not.toBeChecked();
    expect(noSmokers()).not.toBeChecked();
    expect(minContract()).toHaveValue('');
    fireEvent.change(minContract(), { target: { value: '24' } });
    expect(minContract()).toHaveDisplayValue(p.contract['24']);
    expect(beforeUnloadPrevented()).toBe(true);
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '4');
    fireEvent.click(saveButton());
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    expect(opened.api.calls(`PATCH /listings/${a.id}`).map((c) => c.body)).toStrictEqual([
      { min_contract_months: 24 },
    ]);
    opened.view.unmount();
    vi.unstubAllGlobals();

    // Untouched: not dirty, and next → next → next → save sends nothing.
    a = stored({ ...prefs, accepted_households: [...prefs.accepted_households] });
    opened = await openEdit(a);
    expect(beforeUnloadPrevented()).toBe(false);
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '4');
    fireEvent.click(saveButton());
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    expect(opened.api.calls(`PATCH /listings/${a.id}`)).toHaveLength(0);
    expect(screen.queryByText(he.listings.edit.saved)).toBeNull();
    opened.view.unmount();
    vi.unstubAllGlobals();

    // No smokers stored: the switch opens checked.
    a = stored({ smoking_allowed: false, min_contract_months: 36 });
    await openEdit(a);
    detailsToPreferences();
    expect(noSmokers()).toBeChecked();
    expect(minContract()).toHaveDisplayValue(p.contract['36']);
    expect(beforeUnloadPrevented()).toBe(false);
  });

  it('ac6_room_patch_only_changes', async () => {
    const room = stored({
      listing_type: 'room',
      gender_preference: 'men',
      flatmates_count: 2,
      // As the API may order them.
      flatmate_ages: [30, 27],
      lifestyle: { guests: 2, night: 1 },
    });
    const reply = () => json(room);

    // Opens on the stored values, the ages sorted; untouched, nothing is dirty or sent.
    let opened = await openEdit(room);
    expect(beforeUnloadPrevented()).toBe(false);
    detailsToPreferences();
    expect(genderRadio(g.men)).toBeChecked();
    expect(genderRadio(g.any)).not.toBeChecked();
    expect(flatmatesCount()).toHaveValue('2');
    expect(ageSlot(1)).toHaveValue('27');
    expect(ageSlot(2)).toHaveValue('30');
    expect(lifestyleRadio('guests', '2')).toBeChecked();
    expect(lifestyleRadio('night', '1')).toBeChecked();
    expect(lifestyleRadio('cleanliness', '1')).not.toBeChecked();
    expect(lifestyleRadio('cleanliness', '2')).not.toBeChecked();
    expect(lifestyleRadio('cleanliness', '3')).not.toBeChecked();
    expect(beforeUnloadPrevented()).toBe(false);
    expect(await saveFromPreferences(opened.api, room)).toStrictEqual([]);
    expect(screen.queryByText(he.listings.edit.saved)).toBeNull();
    opened.view.unmount();
    vi.unstubAllGlobals();

    // Only the gender.
    opened = await openEdit(room, [reply]);
    detailsToPreferences();
    fireEvent.click(genderRadio(g.any));
    expect(beforeUnloadPrevented()).toBe(true);
    expect(await saveFromPreferences(opened.api, room)).toStrictEqual([
      { gender_preference: 'any' },
    ]);
    opened.view.unmount();
    vi.unstubAllGlobals();

    // Only one age: the whole list, sorted.
    opened = await openEdit(room, [reply]);
    detailsToPreferences();
    change(r.ageOf.replace('{{n}}', '1'), '28');
    expect(await saveFromPreferences(opened.api, room)).toStrictEqual([
      { flatmate_ages: [28, 30] },
    ]);
    opened.view.unmount();
    vi.unstubAllGlobals();

    // Only one answer: the whole questionnaire.
    opened = await openEdit(room, [reply]);
    detailsToPreferences();
    fireEvent.click(lifestyleRadio('guests', '3'));
    expect(await saveFromPreferences(opened.api, room)).toStrictEqual([
      { lifestyle: { guests: 3, night: 1 } },
    ]);
  });

  it('ac7_legacy_room_needs_count', async () => {
    // A room from before Slice 7: no count, everything else default. Untouched: not dirty.
    const legacy = stored({ listing_type: 'room' });
    expect(legacy.flatmates_count).toBeNull();
    let opened = await openEdit(legacy);
    expect(beforeUnloadPrevented()).toBe(false);
    opened.view.unmount();
    vi.unstubAllGlobals();

    opened = await openEdit(legacy, [
      () => json({ ...legacy, price_ils: 7500, flatmates_count: 2 }),
    ]);
    change(f.price, '7500');
    detailsToPreferences();
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
    expect(errorFor(flatmatesCount())).toHaveTextContent(he.listings.errors.required);
    expect(document.activeElement).toBe(flatmatesCount());
    expect(opened.api.calls(`PATCH /listings/${legacy.id}`)).toHaveLength(0);

    fireEvent.change(flatmatesCount(), { target: { value: '2' } });
    expect(flatmatesCount()).not.toHaveAttribute('aria-invalid', 'true');
    expect(await saveFromPreferences(opened.api, legacy)).toStrictEqual([
      { price_ils: 7500, flatmates_count: 2 },
    ]);
  });

  it('ac10_edit_never_switches_type', async () => {
    // Spec 0010a: edit mode opens on details as step 1 of 4, with no back button and no type
    // step; a save never sends `listing_type`, and lands on the listing's own "my" page.
    const room = stored({
      listing_type: 'room',
      gender_preference: 'women',
      flatmates_count: 2,
      flatmate_ages: [27],
      lifestyle: { cleanliness: 3 },
    });
    let opened = await openEdit(room, [() => json({ ...room, price_ils: 7500 })]);
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(progress()).toHaveAttribute('aria-valuemax', '4');
    expect(screen.getByText(i18n.t('listings.stepOf', { n: 1, total: 4 }))).toBeVisible();
    expect(screen.queryByText(he.listings.steps.type)).toBeNull();
    expect(screen.queryByRole('button', { name: he.common.back })).toBeNull();
    expect(screen.queryByRole('radio', { name: he.listings.type.apartment })).toBeNull();
    // A room's back link is the market's "שלי".
    expect(screen.getByRole('link', { name: he.market.mine.back })).toHaveAttribute(
      'href',
      '/market/mine',
    );
    expect(
      screen.getByRole('heading', { level: 2, name: he.listings.stepTitle.detailsRoom }),
    ).toBeVisible();
    change(f.price, '7500');
    // The room's photos step, then its preferences, still a room.
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '2');
    expect(
      screen.getByRole('heading', { level: 2, name: he.listings.stepTitle.photosRoom }),
    ).toBeVisible();
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
    expect(
      screen.getByRole('heading', { level: 2, name: he.listings.prefs.titleRoom }),
    ).toBeVisible();
    expect(genderRadio(g.women)).toBeChecked();
    // Back reaches details, never the type step.
    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    expect(progress()).toHaveAttribute('aria-valuenow', '1');
    expect(screen.queryByRole('button', { name: he.common.back })).toBeNull();
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '4');
    fireEvent.click(saveButton());
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/market/mine');
    });
    expect(opened.api.calls(`PATCH /listings/${room.id}`).map((c) => c.body)).toStrictEqual([
      { price_ils: 7500 },
    ]);
    opened.view.unmount();
    vi.unstubAllGlobals();

    // An apartment stays an apartment: no room block, the PATCH without a type.
    const apartment = stored();
    opened = await openEdit(apartment, [() => json({ ...apartment, price_ils: 7500 })]);
    expect(screen.queryByRole('button', { name: he.common.back })).toBeNull();
    expect(screen.queryByText(he.listings.steps.type)).toBeNull();
    expect(backLink()).toHaveAttribute('href', '/me/listings');
    change(f.price, '7500');
    detailsToPreferences();
    expect(screen.getByRole('heading', { level: 2, name: he.listings.prefs.title })).toBeVisible();
    expect(screen.queryByRole('region', { name: r.title })).toBeNull();
    const bodies = await saveFromPreferences(opened.api, apartment);
    expect(bodies).toStrictEqual([{ price_ils: 7500 }]);
    for (const body of bodies) expect(body).not.toHaveProperty('listing_type');
  });

  it('ac4_h1_while_loading_and_on_error', async () => {
    const a = stored();
    // "My listings" loading: the page's <h1> above the busy block.
    mockApi({ 'GET /me/listings': [never], 'GET /areas': [() => json([gushDan])] });
    let view = renderEdit(a.id);
    await screen.findByRole('heading', { level: 1, name: he.listings.edit.title });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText(he.common.loading).closest('[aria-busy="true"]')).not.toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // "My listings" failing: the <h1> above ErrorState, whose message is no heading.
    mockApi({
      'GET /me/listings': [json({ detail: 'boom' }, 500)],
      'GET /areas': [() => json([gushDan])],
    });
    view = renderEdit(a.id);
    await screen.findByRole('button', { name: he.common.retry });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: he.listings.edit.title })).toBeVisible();
    view.unmount();
  });

  it('ac13 apartment facts load and a cleared one is sent as null', async () => {
    // Spec 0014b AC13.
    const a = stored({
      balcony: true,
      safe_room: false,
      air_conditioning: true,
      condition: 'good',
    });
    const { api } = await openEdit(a, [json({ ...a, balcony: null, condition: null })]);
    const fact = (legend: string, name: string) =>
      within(screen.getByRole('group', { name: legend })).getByRole('radio', { name });
    const cond = he.listings.condition;
    expect(fact(r.balcony, he.common.yes)).toBeChecked();
    expect(fact(f.safeRoom, he.common.no)).toBeChecked();
    expect(fact(f.airConditioning, he.common.yes)).toBeChecked();
    expect(fact(f.condition, cond.good)).toBeChecked();

    fireEvent.click(fact(r.balcony, r.unset));
    fireEvent.click(fact(f.condition, r.unset));
    detailsToPreferences();
    expect(await saveFromPreferences(api, a)).toEqual([{ balcony: null, condition: null }]);
  });

  it('ac13_expired_page_renews', async () => {
    const past = '2020-01-01T00:00:00Z';
    const renewedAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const done = i18n.t('listings.renew.done', {
      date: formatDate(todayInIsrael(new Date(renewedAt))),
    });
    // "My listings" of both sides, where a renewal lands.
    const pageRoutes = (
      <Routes>
        <Route path="/me/listings" element={<MyListingsPage />} />
        <Route path="/market/mine" element={<MyListingsPage type="room" panel />} />
        <Route path="/me/listings/:id/edit" element={<EditListingPage />} />
      </Routes>
    );
    const openExpired = async (
      a: ListingOut,
      renewReplies: Parameters<typeof mockApi>[0][string],
    ) => {
      const api = mockApi({
        'GET /me': [() => json(owner)],
        'GET /me/listings': [() => json([a]), never],
        'GET /areas': [() => json([gushDan])],
        [`POST /listings/${a.id}/renew`]: renewReplies,
      });
      const view = renderRoutes(editPath(a.id), pageRoutes, testQueryClient());
      const heading = await screen.findByRole('heading', {
        level: 1,
        name: he.listings.edit.expiredTitle,
      });
      await vi.waitFor(() => {
        expect(heading).toHaveFocus();
      });
      return { api, view };
    };

    const cases = [
      [stored({ expires_at: past }), '/me/listings'],
      [stored({ status: 'paused', expires_at: past }), '/me/listings'],
      [stored({ listing_type: 'room', flatmates_count: 2, expires_at: past }), '/market/mine'],
    ] as const;
    for (const [a, landing] of cases) {
      const { api, view } = await openExpired(a, [
        () => json({ ...a, status: 'active', expires_at: renewedAt }),
      ]);
      expect(screen.getByText(he.listings.edit.expiredBody)).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: he.listings.actions.renew }));
      await vi.waitFor(() => {
        expect(currentPath()).toBe(landing);
      });
      expect(await screen.findByText(done)).toHaveAttribute('role', 'status');
      const card = screen.getByRole('article');
      expect(within(card).getByRole('link', { name: he.listings.actions.edit })).toHaveAttribute(
        'href',
        editPath(a.id),
      );
      expect(api.calls(`POST /listings/${a.id}/renew`)).toHaveLength(1);
      expect(api.calls(`PATCH /listings/${a.id}`)).toHaveLength(0);
      view.unmount();
      vi.unstubAllGlobals();
    }

    // Refused: the reason under the button, and the page stays.
    const a = stored({ expires_at: past });
    let { view } = await openExpired(a, [json({ detail: 'listing_cap_reached' }, 409)]);
    fireEvent.click(screen.getByRole('button', { name: he.listings.actions.renew }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('listings.errors.capReached', { cap: 3 }),
    );
    expect(currentPath()).toBe(editPath(a.id));
    view.unmount();
    vi.unstubAllGlobals();

    // Offline.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    ({ view } = await openExpired(a, [networkError]));
    fireEvent.click(screen.getByRole('button', { name: he.listings.actions.renew }));
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.offline);
    expect(currentPath()).toBe(editPath(a.id));
    view.unmount();
  });

  it('ac14_save_on_expired_listing', async () => {
    // The listing expired while the wizard was open: the save's PATCH answers listing_expired.
    let a = stored();
    let opened = await changePriceAndSave(a, [json({ detail: 'listing_expired' }, 409)]);
    expect(await screen.findByRole('alert')).toHaveTextContent(he.listings.errors.expired);
    expect(screen.queryByText(i18n.t('listings.errors.capReached', { cap: 3 }))).toBeNull();
    expect(progress()).toHaveAttribute('aria-valuenow', '4');
    expect(currentPath()).toBe(editPath(a.id));
    expect(opened.client.getQueryData<ListingOut[]>(MY_LISTINGS_KEY)).toEqual([a]);
    opened.view.unmount();
    vi.unstubAllGlobals();

    a = stored();
    opened = await changePriceAndSave(a, [json({ detail: 'listing_cap_reached' }, 409)]);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('listings.errors.capReached', { cap: 3 }),
    );
    opened.view.unmount();
  });
});
