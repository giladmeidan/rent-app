import { cleanup as unmount, fireEvent, screen, within } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Route, Routes, useNavigationType } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AreaOut } from '../../../api/client';
import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import {
  currentPath,
  deferred,
  json,
  mockApi,
  renderRoutes,
  testQueryClient,
} from '../../auth/__tests__/harness';
import { RequireSeeker } from '../../auth/RequireSeeker';
import { gushDan, seeker } from '../../listings/__tests__/fixtures';
import { LIFESTYLE_KEYS } from '../../lifestyle/keys';
import { ProfilePage } from '../ProfilePage';
import { PROFILE_KEY } from '../useProfile';
import { birthYearRange } from '../validate';
import { inDays, profile } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

type Reply = Parameters<typeof mockApi>[0][string][number];

const PROFILE = 'GET /me/profile';
const AREAS = 'GET /areas';
const PUT = 'PUT /me/profile';

const sharon: AreaOut = {
  id: '00000000-0000-0000-0000-00000000b2b2',
  slug: 'sharon',
  name_he: 'השרון',
};
const notFound = () => json({ detail: 'seeker_profile_not_found' }, 404);
const savedReply = () => json(profile());

const routes = (
  <Routes>
    <Route element={<RequireSeeker />}>
      <Route path="/me/profile" element={<ProfilePage />} />
    </Route>
    <Route path="/login" element={<p>login</p>} />
    <Route path="/listings/:id" element={<p>listing</p>} />
    <Route path="/" element={<p>home</p>} />
  </Routes>
);

/** A seeker on `path` with these replies (defaults: no profile, two areas, a 200 save); `options`
 * swaps in a query client or a routes tree. */
function renderPage(
  replies: Record<string, Reply[]> = {},
  path = '/me/profile',
  options: { client?: QueryClient; tree?: ReactNode } = {},
) {
  const api = mockApi({
    'GET /me': [json(seeker)],
    [PROFILE]: [notFound()],
    [AREAS]: [json([gushDan, sharon])],
    [PUT]: [savedReply],
    ...replies,
  });
  renderRoutes(path, options.tree ?? routes, options.client ?? testQueryClient());
  return api;
}

const form = async () => {
  await screen.findByRole('button', { name: he.profile.save });
  return screen;
};
const budget = () => screen.getByLabelText<HTMLInputElement>(he.profile.fields.budget);
const moveIn = () => screen.getByLabelText<HTMLInputElement>(he.profile.fields.moveIn);
const toggle = (name: string) => screen.getByRole('switch', { name });
const group = (name: string) => screen.getByRole('group', { name });
const areaBox = (area: AreaOut) =>
  within(group(he.profile.fields.areas)).getByRole('checkbox', { name: area.name_he });
const radio = (groupName: string, name: string) =>
  within(group(groupName)).getByRole('radio', { name });
const save = () => fireEvent.click(screen.getByRole('button', { name: he.profile.save }));
const set = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

/** Fills AC2's form on the empty page. */
async function fillValid() {
  await form();
  set(budget(), '7500');
  set(moveIn(), inDays(30));
  fireEvent.click(toggle(he.profile.fields.flexible));
  fireEvent.click(areaBox(gushDan));
  fireEvent.click(radio(he.profile.fields.household, he.profile.household.couple));
  fireEvent.click(toggle(he.profile.fields.pets));
  fireEvent.click(radio(he.profile.fields.contract, he.profile.contract['24']));
  fireEvent.click(radio(he.profile.fields.parking, he.profile.parking['1']));
}

const AC2_BODY = {
  budget_max_ils: 7500,
  move_in_date: inDays(30),
  move_in_flexible: true,
  area_ids: [gushDan.id],
  household: 'couple',
  has_pets: true,
  smoker: false,
  contract_months: 24,
  parking_needed: 1,
};

/** The text of the element(s) `el`'s `aria-describedby` names. */
function description(el: HTMLElement): string {
  return (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

/** `el` is invalid, described by `message` in a `role="alert"`, and (when `focused`) focused. */
function expectError(el: HTMLElement, message: string, focused = true) {
  expect(el).toHaveAttribute('aria-invalid', 'true');
  expect(description(el)).toBe(message);
  const id = el.getAttribute('aria-describedby') ?? '';
  expect(document.getElementById(id)).toHaveAttribute('role', 'alert');
  if (focused) expect(el).toHaveFocus();
}

/** `profile.saved` in a `role="status"` (the harness's location probe is an `<output>`, also a
 * status, so the line is found by its text). */
async function expectSaved() {
  expect(await screen.findByText(he.profile.saved)).toHaveAttribute('role', 'status');
}

/** Unmounts the current render and drops its fetch mock. */
function cleanup() {
  unmount();
  vi.unstubAllGlobals();
}

const required = he.listings.errors.required;
const range = i18n.t('listings.errors.range', { min: 500, max: 100000 });
const firstArea = () => within(group(he.profile.fields.areas)).getAllByRole('checkbox')[0];

describe('ProfilePage', () => {
  it('ac1_empty_form', async () => {
    const pending = deferred();
    const api = renderPage({ [PROFILE]: [pending.promise] });
    expect(await screen.findByRole('heading', { level: 1, name: he.profile.title })).toBeVisible();
    expect(screen.getByText(he.profile.intro)).toBeVisible();
    expect(screen.getByText(he.profile.privacy)).toBeVisible();
    // While GET /me/profile is pending: one busy skeleton, no form.
    expect(screen.getByTestId('skeleton').closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('button', { name: he.profile.save })).toBeNull();
    pending.resolve(notFound());

    await form();
    expect(budget()).toHaveValue(null);
    expect(budget()).toHaveAttribute('inputmode', 'numeric');
    expect(moveIn()).toHaveValue('');
    expect(moveIn()).toHaveAttribute('min', inDays(0));
    expect(moveIn()).toHaveAttribute('max', inDays(364));
    // One checkbox per area from GET /areas, in its order.
    const boxes = within(group(he.profile.fields.areas)).getAllByRole<HTMLInputElement>('checkbox');
    expect(boxes).toEqual([areaBox(gushDan), areaBox(sharon)]);
    for (const box of boxes) expect(box).not.toBeChecked();
    expect(radio(he.profile.fields.parking, he.profile.parking['0'])).toBeChecked();
    for (const r of within(group(he.profile.fields.household)).getAllByRole('radio')) {
      expect(r).not.toBeChecked();
    }
    for (const r of within(group(he.profile.fields.contract)).getAllByRole('radio')) {
      expect(r).not.toBeChecked();
    }
    for (const name of [
      he.profile.fields.flexible,
      he.profile.fields.pets,
      he.profile.fields.smoker,
    ]) {
      expect(toggle(name)).not.toBeChecked();
    }
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.calls(PROFILE)).toHaveLength(1);
    expect(api.calls(AREAS)).toHaveLength(1);
  });

  it('ac1_load_failures_and_no_areas', async () => {
    // GET /areas fails: one ErrorState; retry refetches only it.
    let api = renderPage({ [AREAS]: [json({}, 500), json([gushDan])] });
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    await form();
    expect(api.calls(AREAS)).toHaveLength(2);
    expect(api.calls(PROFILE)).toHaveLength(1);
    screen.getByRole('button', { name: he.profile.save });
    cleanup();

    // No active areas: the EmptyState replaces the fieldset, and there is no save button.
    api = renderPage({ [AREAS]: [json([])] });
    expect(await screen.findByText(he.areas.empty)).toBeVisible();
    expect(screen.queryByRole('group', { name: he.profile.fields.areas })).toBeNull();
    expect(screen.queryByRole('button', { name: he.profile.save })).toBeNull();
  });

  it('ac2_saves_profile', async () => {
    const put = deferred();
    const api = renderPage({ [PUT]: [put.promise] });
    await fillValid();
    save();
    save();
    await vi.waitFor(() => {
      expect(api.calls(PUT)).toHaveLength(1);
    });
    const button = screen.getByRole('button', { name: he.profile.save });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    const [call] = api.calls(PUT);
    expect(call?.body).toStrictEqual(AC2_BODY);
    expect(call?.request.credentials).toBe('include');

    put.resolve(json(profile()));
    await expectSaved();
    expect(api.calls(PUT)).toHaveLength(1);
    expect(currentPath()).toBe('/me/profile');
  });

  it('ac3_prefills_and_drops_inactive_area', async () => {
    const gone = '00000000-0000-0000-0000-00000000dead';
    const stored = profile({ area_ids: [gone, sharon.id], smoker: true, move_in_flexible: false });
    const api = renderPage({ [PROFILE]: [json(stored)] });
    await form();
    expect(budget()).toHaveValue(7500);
    expect(moveIn()).toHaveValue(stored.move_in_date);
    expect(toggle(he.profile.fields.flexible)).not.toBeChecked();
    expect(toggle(he.profile.fields.pets)).toBeChecked();
    expect(toggle(he.profile.fields.smoker)).toBeChecked();
    expect(radio(he.profile.fields.household, he.profile.household.couple)).toBeChecked();
    expect(radio(he.profile.fields.contract, he.profile.contract['24'])).toBeChecked();
    expect(radio(he.profile.fields.parking, he.profile.parking['1'])).toBeChecked();
    expect(areaBox(sharon)).toBeChecked();
    expect(areaBox(gushDan)).not.toBeChecked();
    // The stored id that GET /areas no longer lists is nowhere on the page.
    expect(within(group(he.profile.fields.areas)).getAllByRole('checkbox')).toHaveLength(2);
    expect(document.querySelector(`input[value="${gone}"]`)).toBeNull();

    save();
    await expectSaved();
    expect(api.calls(PUT).map((c) => c.body)).toStrictEqual([
      {
        budget_max_ils: 7500,
        move_in_date: stored.move_in_date,
        move_in_flexible: false,
        area_ids: [sharon.id],
        household: 'couple',
        has_pets: true,
        smoker: true,
        contract_months: 24,
        parking_needed: 1,
      },
    ]);
  });

  it('ac3_past_stored_date_fails_until_changed', async () => {
    const api = renderPage({ [PROFILE]: [json(profile({ move_in_date: inDays(-3) }))] });
    await form();
    expect(moveIn()).toHaveValue(inDays(-3));
    save();
    expectError(moveIn(), he.profile.errors.moveIn);
    expect(api.calls(PUT)).toHaveLength(0);
    set(moveIn(), inDays(10));
    expect(moveIn()).toHaveAttribute('aria-invalid', 'false');
    save();
    await expectSaved();
    expect(api.calls(PUT)).toHaveLength(1);
  });

  type Row = {
    name: string;
    change: () => void;
    field: () => HTMLElement;
    message: string;
  };
  const rows: Row[] = [
    { name: 'budget empty', change: () => set(budget(), ''), field: budget, message: required },
    { name: 'budget 499', change: () => set(budget(), '499'), field: budget, message: range },
    { name: 'budget 100001', change: () => set(budget(), '100001'), field: budget, message: range },
    { name: 'budget 7500.5', change: () => set(budget(), '7500.5'), field: budget, message: range },
    { name: 'date empty', change: () => set(moveIn(), ''), field: moveIn, message: required },
    {
      name: 'date yesterday',
      change: () => set(moveIn(), inDays(-1)),
      field: moveIn,
      message: he.profile.errors.moveIn,
    },
    {
      name: 'date today + 365',
      change: () => set(moveIn(), inDays(365)),
      field: moveIn,
      message: he.profile.errors.moveIn,
    },
    {
      name: 'no area',
      change: () => fireEvent.click(areaBox(gushDan)),
      field: () => firstArea() as HTMLElement,
      message: he.profile.errors.areas,
    },
    {
      name: 'no household',
      change: () => undefined,
      field: () => radio(he.profile.fields.household, he.profile.household.single),
      message: required,
    },
    {
      name: 'no contract',
      change: () => undefined,
      field: () => radio(he.profile.fields.contract, he.profile.contract['6']),
      message: required,
    },
  ];

  it.each(rows)('ac4_client_validation: $name', async (row) => {
    const api = renderPage();
    await form();
    if (row.name === 'no household') {
      // AC2's form without a household: fill everything else.
      set(budget(), '7500');
      set(moveIn(), inDays(30));
      fireEvent.click(areaBox(gushDan));
      fireEvent.click(radio(he.profile.fields.contract, he.profile.contract['24']));
    } else if (row.name === 'no contract') {
      set(budget(), '7500');
      set(moveIn(), inDays(30));
      fireEvent.click(areaBox(gushDan));
      fireEvent.click(radio(he.profile.fields.household, he.profile.household.couple));
    } else {
      await fillValid();
      row.change();
    }
    save();
    expectError(row.field(), row.message);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(api.calls(PUT)).toHaveLength(0);
  });

  it('ac4_client_validation: the empty form', async () => {
    const api = renderPage();
    await form();
    save();
    expectError(budget(), required);
    expectError(moveIn(), required, false);
    expectError(firstArea() as HTMLElement, he.profile.errors.areas, false);
    expectError(radio(he.profile.fields.household, he.profile.household.single), required, false);
    expectError(radio(he.profile.fields.contract, he.profile.contract['6']), required, false);
    expect(screen.getAllByRole('alert')).toHaveLength(5);
    expect(api.calls(PUT)).toHaveLength(0);
  });

  it('ac5_server_errors', async () => {
    const msg = 'Input should be less than or equal to 100000';

    // 422 at body.budget_max_ils: the field's own error, focused; the English msg never shown.
    let api = renderPage({
      [PROFILE]: [json(profile())],
      [PUT]: [json({ detail: [{ loc: ['body', 'budget_max_ils'], msg, type: 'x' }] }, 422)],
    });
    await form();
    save();
    await vi.waitFor(() => {
      expectError(budget(), he.listings.errors.invalid);
    });
    expect(document.body.textContent).not.toContain(msg);
    cleanup();

    // 422 at body.area_ids.0: on the areas fieldset.
    renderPage({
      [PROFILE]: [json(profile())],
      [PUT]: [json({ detail: [{ loc: ['body', 'area_ids', 0], msg, type: 'uuid' }] }, 422)],
    });
    await form();
    save();
    await vi.waitFor(() => {
      expectError(firstArea() as HTMLElement, he.listings.errors.invalid);
    });
    cleanup();

    // 422 unknown_area: GET /areas again, areaInactive on the fieldset; the refetched list drops
    // the chosen Sharon, so the second save sends Gush Dan only.
    api = renderPage({
      [PROFILE]: [json(profile({ area_ids: [gushDan.id, sharon.id] }))],
      [AREAS]: [json([gushDan, sharon]), json([gushDan])],
      [PUT]: [json({ detail: 'unknown_area' }, 422), savedReply],
    });
    await form();
    save();
    await vi.waitFor(() => {
      expect(api.calls(AREAS)).toHaveLength(2);
    });
    await vi.waitFor(() => {
      expect(within(group(he.profile.fields.areas)).getAllByRole('checkbox')).toHaveLength(1);
    });
    expectError(firstArea() as HTMLElement, he.profile.errors.areaInactive, false);
    save();
    await expectSaved();
    expect(api.calls(PUT).map((c) => (c.body as { area_ids: string[] }).area_ids)).toEqual([
      [gushDan.id, sharon.id],
      [gushDan.id],
    ]);
    cleanup();

    // The same with only Sharon chosen: no area left, so the client refuses the second save.
    api = renderPage({
      [PROFILE]: [json(profile({ area_ids: [sharon.id] }))],
      [AREAS]: [json([gushDan, sharon]), json([gushDan])],
      [PUT]: [json({ detail: 'unknown_area' }, 422)],
    });
    await form();
    save();
    await vi.waitFor(() => {
      expect(within(group(he.profile.fields.areas)).getAllByRole('checkbox')).toHaveLength(1);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(he.profile.errors.areaInactive);
    save();
    expectError(firstArea() as HTMLElement, he.profile.errors.areas);
    expect(api.calls(PUT)).toHaveLength(1);
    cleanup();

    // A 422 list naming no form field: the generic ErrorState.
    renderPage({
      [PROFILE]: [json(profile())],
      [PUT]: [json({ detail: [{ loc: ['query', 'x'], msg, type: 'x' }] }, 422)],
    });
    await form();
    save();
    expect(await screen.findByRole('button', { name: he.common.retry })).toBeVisible();
    cleanup();

    // 500: ErrorState; retry sends the same body.
    api = renderPage({ [PUT]: [json({ detail: 'boom' }, 500), savedReply] });
    await fillValid();
    save();
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    await expectSaved();
    expect(api.calls(PUT).map((c) => c.body)).toStrictEqual([AC2_BODY, AC2_BODY]);
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    cleanup();

    // 401: the session is forgotten and RequireSeeker sends the person to /login.
    renderPage({ [PUT]: [json({ detail: 'unauthenticated' }, 401)] });
    await fillValid();
    save();
    await vi.waitFor(() => {
      expect(currentPath()).toBe(`/login?next=${encodeURIComponent('/me/profile')}`);
    });
  });

  it('ac5_profile_401_on_load_goes_to_login', async () => {
    renderPage({ [PROFILE]: [json({ detail: 'unauthenticated' }, 401)] });
    await vi.waitFor(() => {
      expect(currentPath()).toBe(`/login?next=${encodeURIComponent('/me/profile')}`);
    });
  });

  it('ac6_next_is_safe', async () => {
    renderPage({ [PROFILE]: [json(profile())] }, '/me/profile?next=%2Flistings%2Fabc');
    await form();
    save();
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/listings/abc');
    });
    cleanup();

    for (const path of ['/me/profile?next=%2F%2Fevil.example', '/me/profile']) {
      const api = renderPage({ [PROFILE]: [json(profile())] }, path);
      await form();
      save();
      await expectSaved();
      expect(currentPath()).toBe(path);
      expect(api.calls(PUT)).toHaveLength(1);
      cleanup();
    }
  });
  // The room section (0007d).
  const room = he.profile.room;
  const roomSwitch = () => toggle(room.switch);
  const birthYear = () => screen.getByLabelText<HTMLInputElement>(room.fields.birthYear);
  const questionnaire = () => screen.getByRole('region', { name: he.lifestyle.title.seeker });
  const answer = (key: (typeof LIFESTYLE_KEYS)[number], n: '1' | '2' | '3') =>
    radio(he.lifestyle[key].question.seeker, he.lifestyle[key].answer[n]);
  const checkedAnswers = () =>
    LIFESTYLE_KEYS.flatMap((key) =>
      within(group(he.lifestyle[key].question.seeker))
        .getAllByRole<HTMLInputElement>('radio')
        .filter((r) => r.checked)
        .map((r) => `${key}=${r.value}`),
    );

  /** Nothing of the revealed room content is in the DOM. */
  function expectRoomClosed() {
    expect(screen.queryByText(room.privacy)).toBeNull();
    expect(screen.queryByRole('group', { name: room.fields.gender })).toBeNull();
    expect(screen.queryByLabelText(room.fields.birthYear)).toBeNull();
    expect(screen.queryByRole('group', { name: room.fields.flatmates })).toBeNull();
    expect(screen.queryByRole('region', { name: he.lifestyle.title.seeker })).toBeNull();
    expect(screen.queryByText(he.lifestyle.nudge)).toBeNull();
  }

  /** Each element comes after the previous one in document order. */
  function expectInOrder(elements: HTMLElement[]) {
    for (let i = 1; i < elements.length; i++) {
      const before = elements[i - 1] as HTMLElement;
      const after = elements[i] as HTMLElement;
      expect(before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  }

  it('ac4_room_switch_reveals_and_off_omits', async () => {
    const api = renderPage();
    await fillValid();
    expect(screen.getByRole('heading', { level: 2, name: room.title })).toBeVisible();
    expect(screen.getByText(room.hint)).toBeVisible();
    expect(screen.getByRole('region', { name: room.title })).toContainElement(roomSwitch());
    expect(roomSwitch()).not.toBeChecked();
    expectRoomClosed();

    fireEvent.click(roomSwitch());
    expect(roomSwitch()).toBeChecked();
    const privacy = screen.getByText(room.privacy);
    const gender = group(room.fields.gender);
    const flatmates = group(room.fields.flatmates);
    expectInOrder([roomSwitch(), privacy, gender, birthYear(), flatmates, questionnaire()]);
    expect(
      within(gender)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('name')),
    ).toEqual(['gender', 'gender', 'gender']);
    for (const r of within(gender).getAllByRole('radio')) expect(r).not.toBeChecked();
    expect(screen.getByText(room.genderNote)).toBeVisible();
    expect(birthYear()).toHaveValue('');
    expect(birthYear()).toHaveAttribute('inputmode', 'numeric');
    expect(birthYear()).toHaveAttribute('maxlength', '4');
    expect(birthYear()).toHaveAccessibleDescription(room.birthYearHint);
    expect(
      within(flatmates)
        .getAllByRole('radio')
        .map((r) => (r as HTMLInputElement).labels?.[0]?.textContent),
    ).toEqual([
      he.rooms.genderPreference.women,
      he.rooms.genderPreference.men,
      he.rooms.genderPreference.any,
    ]);
    expect(radio(room.fields.flatmates, he.rooms.genderPreference.any)).toBeChecked();
    expect(checkedAnswers()).toEqual([]);
    expect(screen.queryByRole('alert')).toBeNull();

    // Something typed, then off again: the save sends the housing profile only.
    fireEvent.click(radio(room.fields.gender, room.gender.woman));
    fireEvent.click(answer('night', '1'));
    fireEvent.click(roomSwitch());
    expect(roomSwitch()).not.toBeChecked();
    expectRoomClosed();
    save();
    await expectSaved();
    expect(api.calls(PUT).map((c) => c.body)).toStrictEqual([AC2_BODY]);
  });

  it('ac5_room_gender_required_and_body', async () => {
    const api = renderPage();
    await fillValid();
    fireEvent.click(roomSwitch());
    save();
    const woman = () => radio(room.fields.gender, room.gender.woman);
    expectError(woman(), required);
    for (const r of within(group(room.fields.gender)).getAllByRole('radio')) {
      expect(r).toHaveAttribute('aria-invalid', 'true');
    }
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(api.calls(PUT)).toHaveLength(0);

    // Off with the error showing and on again: no stale alert.
    fireEvent.click(roomSwitch());
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(roomSwitch());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(woman()).not.toHaveAttribute('aria-invalid');

    fireEvent.click(woman());
    fireEvent.click(radio(room.fields.flatmates, he.rooms.genderPreference.men));
    fireEvent.click(answer('cleanliness', '3'));
    fireEvent.click(answer('kosher', '1'));
    save();
    await expectSaved();
    expect(api.calls(PUT).map((c) => c.body)).toStrictEqual([
      {
        ...AC2_BODY,
        gender: 'woman',
        flatmate_gender: 'men',
        lifestyle: { cleanliness: 3, kosher: 1 },
      },
    ]);
  });

  it('ac6_birth_year_rules', async () => {
    const { min, max } = birthYearRange();
    const message = i18n.t('listings.errors.range', { min, max });
    const year = new Date().getUTCFullYear();
    const api = renderPage({ [PROFILE]: [json(profile({ gender: 'woman' }))] });
    await form();
    expect(roomSwitch()).toBeChecked();

    for (const value of ['abcd', '19x5', String(year - 17), String(year - 100)]) {
      set(birthYear(), value);
      expect(birthYear()).toHaveAttribute('aria-invalid', 'false');
      save();
      const field = birthYear();
      expect(field, value).toHaveAttribute('aria-invalid', 'true');
      expect(field).toHaveFocus();
      expect(field).toHaveAccessibleDescription(expect.stringContaining(message));
      expect(field).toHaveAccessibleDescription(expect.stringContaining(room.birthYearHint));
      const errorId = (field.getAttribute('aria-describedby') ?? '').split(' ')[1] ?? '';
      expect(document.getElementById(errorId)).toHaveAttribute('role', 'alert');
      expect(document.getElementById(errorId)).toHaveTextContent(message);
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    }
    expect(api.calls(PUT)).toHaveLength(0);

    // The oldest and youngest valid years save as numbers; an empty one is left out.
    for (const value of [String(min), ` ${String(max)} `, '']) {
      set(birthYear(), value);
      save();
      await expectSaved();
    }
    const sent = api.calls(PUT).map((c) => c.body as Record<string, unknown>);
    expect(sent.map((b) => b.birth_year)).toEqual([min, max, undefined]);
    expect(sent[2]).not.toHaveProperty('birth_year');
    expect(sent[2]).toStrictEqual({
      ...AC2_BODY,
      gender: 'woman',
      flatmate_gender: 'any',
      lifestyle: {},
    });

    // Room off: a junk year is neither checked nor sent.
    set(birthYear(), 'abcd');
    fireEvent.click(roomSwitch());
    save();
    await vi.waitFor(() => {
      expect(api.calls(PUT)).toHaveLength(4);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.calls(PUT)[3]?.body).toStrictEqual(AC2_BODY);
  });

  it('ac7_prefilled_and_off_clears', async () => {
    const stored = profile({
      gender: 'man',
      birth_year: 1995,
      flatmate_gender: 'women',
      lifestyle: { night: 3, shabbat: 2 },
    });
    const response = profile({ updated_at: '2026-11-11T09:00:00Z' });
    const client = testQueryClient();
    let api = renderPage({ [PROFILE]: [json(stored)], [PUT]: [json(response)] }, '/me/profile', {
      client,
    });
    await form();
    expect(roomSwitch()).toBeChecked();
    expect(radio(room.fields.gender, room.gender.man)).toBeChecked();
    expect(radio(room.fields.gender, room.gender.woman)).not.toBeChecked();
    expect(radio(room.fields.flatmates, he.rooms.genderPreference.women)).toBeChecked();
    expect(radio(room.fields.flatmates, he.rooms.genderPreference.men)).not.toBeChecked();
    expect(birthYear()).toHaveValue('1995');
    expect(checkedAnswers()).toEqual(['night=3', 'shabbat=2']);

    // Off and on again before saving: what was typed comes back.
    set(birthYear(), '1990');
    fireEvent.click(answer('cleanliness', '2'));
    fireEvent.click(roomSwitch());
    expectRoomClosed();
    fireEvent.click(roomSwitch());
    expect(birthYear()).toHaveValue('1990');
    expect(radio(room.fields.gender, room.gender.man)).toBeChecked();
    expect(radio(room.fields.flatmates, he.rooms.genderPreference.women)).toBeChecked();
    expect(checkedAnswers()).toEqual(['cleanliness=2', 'night=3', 'shabbat=2']);

    // Off and save: the four keys are left out, so the server clears the section.
    fireEvent.click(roomSwitch());
    save();
    await expectSaved();
    expect(api.calls(PUT).map((c) => c.body)).toStrictEqual([AC2_BODY]);
    expect(client.getQueryData(PROFILE_KEY)).toStrictEqual(response);
    cleanup();

    // The page reopens from the cached answer: the switch off.
    api = renderPage({ [PROFILE]: [json(response)] }, '/me/profile', { client });
    await form();
    expect(roomSwitch()).not.toBeChecked();
    expectRoomClosed();
    cleanup();

    // A stored profile with no gender opens with the switch off.
    renderPage({ [PROFILE]: [json(profile())] });
    await form();
    expect(roomSwitch()).not.toBeChecked();
    expectRoomClosed();
    expect(api.calls(PUT)).toHaveLength(0);
  });

  it('ac8_section_room_entry_point', async () => {
    function Listing() {
      return <output data-testid="navigation">{useNavigationType()}</output>;
    }
    const tree = (
      <Routes>
        <Route element={<RequireSeeker />}>
          <Route path="/me/profile" element={<ProfilePage />} />
        </Route>
        <Route path="/listings/:id" element={<Listing />} />
      </Routes>
    );
    const heading = () => screen.getByRole('heading', { level: 2, name: room.title });

    // The gate's link: the switch on for a profile with no gender, the room heading focused, and
    // back to the listing (replace) after the save.
    let api = renderPage(
      { [PROFILE]: [json(profile())] },
      '/me/profile?section=room&next=%2Flistings%2Fabc',
      { tree },
    );
    await form();
    expect(roomSwitch()).toBeChecked();
    expect(screen.getByText(room.privacy)).toBeVisible();
    await vi.waitFor(() => {
      expect(heading()).toHaveFocus();
    });
    expect(heading()).toHaveAttribute('tabindex', '-1');
    fireEvent.click(radio(room.fields.gender, room.gender.woman));
    save();
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/listings/abc');
    });
    expect(screen.getByTestId('navigation')).toHaveTextContent('REPLACE');
    expect(api.calls(PUT).map((c) => (c.body as { gender?: string }).gender)).toEqual(['woman']);
    cleanup();

    // No `next`, or an unsafe one: the page stays after saving.
    for (const path of [
      '/me/profile?section=room',
      '/me/profile?section=room&next=%2F%2Fevil.example',
    ]) {
      api = renderPage({ [PROFILE]: [json(profile())] }, path);
      await form();
      expect(roomSwitch()).toBeChecked();
      await vi.waitFor(() => {
        expect(heading()).toHaveFocus();
      });
      fireEvent.click(radio(room.fields.gender, room.gender.other));
      save();
      await expectSaved();
      expect(currentPath()).toBe(path);
      expect(api.calls(PUT)).toHaveLength(1);
      cleanup();
    }

    // Without `section=room` (or with another value): the switch follows the profile, no focus.
    for (const path of ['/me/profile', '/me/profile?section=other']) {
      renderPage({ [PROFILE]: [json(profile())] }, path);
      await form();
      expect(roomSwitch()).not.toBeChecked();
      expectRoomClosed();
      expect(heading()).not.toHaveFocus();
      expect(document.activeElement).toBe(document.body);
      cleanup();
    }
  });
});
