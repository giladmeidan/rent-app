import { cleanup as unmount, fireEvent, screen, within } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Route, Routes, useNavigationType } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AreaOut } from '../../../api/client';
import i18n from '../../../app/i18n';
import { choiceSegment } from '../../../components/ChoiceGroup';
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
import { RequireSeeker } from '../../auth/RequireSeeker';
import { gushDan, seeker } from '../../listings/__tests__/fixtures';
import { LIFESTYLE_KEYS } from '../../lifestyle/keys';
import { readDraft, writeDraft } from '../../../app/drafts';
import { markSeen, readSeen } from '../../listings/seen';
import { ME_KEY } from '../../auth/useMe';
import { ProfilePage } from '../ProfilePage';
import { PROFILE_KEY } from '../useProfile';
import { birthYearRange } from '../validate';
import { inDays, personalOnlyProfile, profile } from './fixtures';

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
  shelter_needed: 'any',
  // The personal part off (0010c): its fields go empty, so the server clears them; the people
  // switch and the flatmates preference need both parts.
  people_visible: false,
  about_me: null,
  gender: null,
  birth_year: null,
  lifestyle: {},
  flatmate_gender: 'any',
};
/** `AC2_BODY` with the personal part on: an empty birth year is left out, as before 0010c. */
const AC2_WITH_PERSONAL: Partial<typeof AC2_BODY> = { ...AC2_BODY };
delete AC2_WITH_PERSONAL.birth_year;

/** "התאריך שנבחר: …", a date input's read-back (0009f). */
const readbackText = new RegExp(`^${he.common.dateChosen.replace('{{date}}', '')}`);

/** `el` is invalid, described by `message` in a `role="alert"`, and (when `focused`) focused.
 * A date input may also list its read-back (0009f), which is the only other id allowed. */
function expectError(el: HTMLElement, message: string, focused = true) {
  expect(el).toHaveAttribute('aria-invalid', 'true');
  const [id = '', ...rest] = (el.getAttribute('aria-describedby') ?? '').split(' ');
  expect(document.getElementById(id)).toHaveAttribute('role', 'alert');
  expect(document.getElementById(id)?.textContent).toBe(message);
  for (const other of rest) {
    expect(document.getElementById(other)?.textContent).toMatch(readbackText);
  }
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

  it('ac9_shelter_needed_choice', async () => {
    // Spec 0015b: "מרחב מוגן" in the looking part, right after parking; three options, "לא חשוב לי"
    // by default; the chosen one is sent and a saved one pre-selected.
    const sh = he.profile.shelter;
    const api = renderPage({ [PUT]: [json(profile({ shelter_needed: 'mamad' }))] });
    await fillValid();
    const shelter = group(he.profile.fields.shelter);
    expect(
      within(shelter)
        .getAllByRole('radio')
        .map((r) => (r as HTMLInputElement).labels?.[0]?.textContent),
    ).toEqual([sh.any, sh.protected, sh.mamad]);
    expect(radio(he.profile.fields.shelter, sh.any)).toBeChecked();
    expect(
      group(he.profile.fields.parking).compareDocumentPosition(shelter) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(group(he.profile.fields.parking).parentElement).toBe(shelter.parentElement);
    fireEvent.click(radio(he.profile.fields.shelter, sh.mamad));
    save();
    await expectSaved();
    expect(api.calls(PUT)[0]?.body).toStrictEqual({ ...AC2_BODY, shelter_needed: 'mamad' });
    unmount();
    vi.unstubAllGlobals();

    renderPage({ [PROFILE]: [json(profile({ shelter_needed: 'protected' }))] });
    await form();
    expect(radio(he.profile.fields.shelter, sh.protected)).toBeChecked();
  });

  it('ac4_saved_takes_focus', async () => {
    // An in-page save (no `next`): the "saved" line takes focus (and so scrolls into view).
    renderPage({ [PROFILE]: [json(profile())] });
    await form();
    const button = screen.getByRole('button', { name: he.profile.save });
    button.focus();
    save();
    const line = await screen.findByText(he.profile.saved);
    await vi.waitFor(() => {
      expect(line).toHaveFocus();
    });
    expect(line).toHaveAttribute('role', 'status');
    cleanup();

    // An unsafe `next` stays here too: the same.
    renderPage({ [PROFILE]: [json(profile())] }, '/me/profile?next=%2F%2Fevil.example');
    await form();
    save();
    const unsafe = await screen.findByText(he.profile.saved);
    await vi.waitFor(() => {
      expect(unsafe).toHaveFocus();
    });
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
        shelter_needed: 'any',
        people_visible: false,
        about_me: null,
        gender: null,
        birth_year: null,
        lifestyle: {},
        flatmate_gender: 'any',
      },
    ]);
  });

  it('ac3_move_in_read_back', async () => {
    // "התאריך שנבחר: 12 בנובמבר 2026"
    const chosen =
      '\u05d4\u05ea\u05d0\u05e8\u05d9\u05da \u05e9\u05e0\u05d1\u05d7\u05e8: 12 \u05d1\u05e0\u05d5\u05d1\u05de\u05d1\u05e8 2026';
    const ids = () => (moveIn().getAttribute('aria-describedby') ?? '').split(' ');
    renderPage({ [PROFILE]: [json(profile({ move_in_date: '2026-11-12' }))] });
    await form();
    expect(moveIn()).toHaveValue('2026-11-12');
    const readback = screen.getByText(chosen);
    expect(ids()).toEqual([readback.id]);
    // Under the input.
    expect(
      moveIn().compareDocumentPosition(readback) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // A cleared date: no read-back and no idref to it; the required error keeps its id.
    set(moveIn(), '');
    expect(screen.queryByText(chosen)).toBeNull();
    save();
    expectError(moveIn(), required);
    expect(ids()).toHaveLength(1);
    cleanup();

    // A stored past date: the error and the read-back are both listed.
    renderPage({ [PROFILE]: [json(profile({ move_in_date: inDays(-3) }))] });
    await form();
    save();
    expectError(moveIn(), he.profile.errors.moveIn);
    expect(ids()).toHaveLength(2);
    expect(document.getElementById(ids()[1] ?? '')?.textContent).toMatch(readbackText);
  });

  it('ac3_past_stored_date_fails_until_changed', async () => {
    const api = renderPage({ [PROFILE]: [json(profile({ move_in_date: inDays(-3) }))] });
    await form();
    expect(moveIn()).toHaveValue(inDays(-3));
    save();
    expectError(moveIn(), he.profile.errors.moveIn);
    expect(api.calls(PUT)).toHaveLength(0);
    set(moveIn(), inDays(10));
    expect(moveIn()).not.toHaveAttribute('aria-invalid', 'true');
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

  it('ac5_rate_limited_save_says_when', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ 'Retry-After': '7200' }, 'הפרופיל נשמר הרבה פעמים בזמן קצר. אפשר לנסות שוב בעוד שעתיים.'],
      [{}, he.profile.errors.rateLimited],
    ];
    for (const [headers, text] of cases) {
      renderPage({
        [PROFILE]: [json(profile())],
        [PUT]: [json({ detail: 'rate_limited' }, 429, headers)],
      });
      await form();
      save();
      expect((await screen.findByRole('alert')).textContent).toBe(text);
      cleanup();
    }
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
  // The personal part ("עליי"; 0007d's room section, 0010c).
  const room = he.profile.room;
  const about = he.profile.about;
  const roomSwitch = () => toggle(about.switch);
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

  /** Nothing of the revealed personal content is in the DOM. */
  function expectRoomClosed() {
    expect(screen.queryByText(about.privacy)).toBeNull();
    expect(screen.queryByLabelText(room.aboutMe)).toBeNull();
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
    expect(screen.getByRole('heading', { level: 2, name: about.title })).toBeVisible();
    expect(screen.getByText(about.hint)).toBeVisible();
    expect(screen.getByRole('region', { name: about.title })).toContainElement(roomSwitch());
    expect(roomSwitch()).not.toBeChecked();
    expectRoomClosed();
    // The flatmates preference sits in "מה מחפשים" and waits for "עליי".
    expect(screen.getByText(he.profile.looking.flatmatesNeedsAbout)).toBeVisible();

    fireEvent.click(roomSwitch());
    expect(roomSwitch()).toBeChecked();
    expect(screen.queryByText(he.profile.looking.flatmatesNeedsAbout)).toBeNull();
    const privacy = screen.getByText(about.privacy);
    const gender = group(room.fields.gender);
    const flatmates = group(room.fields.flatmates);
    const aboutMe = screen.getByLabelText(room.aboutMe);
    expectInOrder([roomSwitch(), gender, birthYear(), aboutMe, questionnaire(), privacy]);
    expect(screen.getByRole('region', { name: he.profile.sections.search })).toContainElement(
      flatmates,
    );
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

    // Something typed, then off again: the save sends the personal part empty.
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
        ...AC2_WITH_PERSONAL,
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
      expect(birthYear()).not.toHaveAttribute('aria-invalid', 'true');
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
      ...AC2_WITH_PERSONAL,
      gender: 'woman',
      flatmate_gender: 'any',
      lifestyle: {},
    });

    // The personal part off: a junk year is neither checked nor sent (it goes as `null`).
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

    // Off and save: the personal part goes empty, so the server clears it.
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

  it('ac8_section_about_entry_point', async () => {
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
    const heading = () => screen.getByRole('heading', { level: 2, name: about.title });

    // The gate's link: the switch on for a profile with no gender, the "עליי" heading focused, and
    // back to the listing (replace) after the save.
    let api = renderPage(
      { [PROFILE]: [json(profile())] },
      '/me/profile?section=about&next=%2Flistings%2Fabc',
      { tree },
    );
    await form();
    expect(roomSwitch()).toBeChecked();
    expect(screen.getByText(about.privacy)).toBeVisible();
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
      '/me/profile?section=about',
      '/me/profile?section=about&next=%2F%2Fevil.example',
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

    // Without `section=about` (or with another value, or the retired `room`): the switch follows
    // the profile, no focus.
    for (const path of ['/me/profile', '/me/profile?section=other', '/me/profile?section=room']) {
      renderPage({ [PROFILE]: [json(profile())] }, path);
      await form();
      expect(roomSwitch()).not.toBeChecked();
      expectRoomClosed();
      expect(heading()).not.toHaveFocus();
      expect(document.activeElement).toBe(document.body);
      cleanup();
    }
  });

  it('ac1_people_fields', async () => {
    const roomSection = he.profile.room;
    const people = he.profile.people;
    const stored = profile({ gender: 'woman' });
    const switchOn = () => toggle(people.visible);
    const aboutMe = () => screen.getByLabelText<HTMLTextAreaElement>(roomSection.aboutMe);

    // Opt in and write two lines: both are sent, the newline kept.
    let api = renderPage({ [PROFILE]: [json(stored)] });
    await form();
    expect(switchOn()).not.toBeChecked();
    expect(screen.getByText(people.visibleHint)).toBeVisible();
    expect(aboutMe()).toHaveValue('');
    expect(aboutMe()).toHaveAttribute('maxlength', '300');
    expect(aboutMe()).toHaveAttribute('rows', '4');
    expect(aboutMe().tagName).toBe('TEXTAREA');
    expect(switchOn()).toHaveAccessibleDescription(people.visibleHint);
    expect(aboutMe()).toHaveAccessibleDescription(
      i18n.t('listings.fields.charsLeft', { count: 300 }),
    );
    fireEvent.click(switchOn());
    set(aboutMe(), 'שלום, אני סטודנטית');
    expect(aboutMe()).toHaveAccessibleDescription(
      i18n.t('listings.fields.charsLeft', { count: 282 }),
    );
    save();
    await expectSaved();
    expect(api.calls(PUT)[0]?.body).toMatchObject({
      people_visible: true,
      about_me: 'שלום, אני סטודנטית',
    });
    set(aboutMe(), 'שורה ראשונה\nשורה שנייה');
    save();
    await vi.waitFor(() => {
      expect(api.calls(PUT)).toHaveLength(2);
    });
    expect(api.calls(PUT)[1]?.body).toMatchObject({ about_me: 'שורה ראשונה\nשורה שנייה' });
    cleanup();

    // The personal part off: the fields are gone and the body says false / null.
    api = renderPage({
      [PROFILE]: [json(profile({ gender: 'woman', people_visible: true, about_me: 'היי' }))],
    });
    await form();
    expect(switchOn()).toBeChecked();
    expect(aboutMe()).toHaveValue('היי');
    fireEvent.click(toggle(he.profile.about.switch));
    expect(screen.queryByLabelText(roomSection.aboutMe)).toBeNull();
    expect(screen.queryByRole('switch', { name: people.visible })).toBeNull();
    expect(screen.getByText(people.needsBoth)).toBeVisible();
    save();
    await expectSaved();
    expect(api.calls(PUT)[0]?.body).toMatchObject({ people_visible: false, about_me: null });
    cleanup();

    // Client rules: too long and letterless show under the textarea, with focus.
    api = renderPage({ [PROFILE]: [json(stored)] });
    await form();
    set(aboutMe(), 'א'.repeat(301));
    save();
    // The description is the counter, then the error (the birth-year field's pattern).
    expect(aboutMe()).toHaveAttribute('aria-invalid', 'true');
    expect(aboutMe()).toHaveFocus();
    expect(aboutMe()).toHaveAccessibleDescription(
      expect.stringContaining(he.profile.errors.aboutMeTooLong),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(he.profile.errors.aboutMeTooLong);
    expect(api.calls(PUT)).toHaveLength(0);
    set(aboutMe(), '!!!');
    save();
    expect(aboutMe()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent(required);
    cleanup();

    // A server 422 on about_me: under the textarea, focused.
    renderPage({
      [PROFILE]: [json(stored)],
      [PUT]: [
        json({ detail: [{ loc: ['body', 'about_me'], msg: 'bad', type: 'value_error' }] }, 422),
      ],
    });
    await form();
    set(aboutMe(), 'שלום');
    save();
    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(he.listings.errors.invalid);
    });
    expect(aboutMe()).toHaveAttribute('aria-invalid', 'true');
    expect(aboutMe()).toHaveFocus();
  });

  // Spec 0009r: the sections, the side index, the save bar and the areas' check mark.
  describe('0009r layout', () => {
    const navName = he.profile.nav.label;
    const formEl = () => document.querySelector('form') as HTMLFormElement;
    const names = () => {
      const all = [...formEl().querySelectorAll<HTMLInputElement>('input[name], textarea[name]')];
      return [...new Set(all.map((el) => el.name))];
    };

    it('ac1_sections_index_and_field_order', async () => {
      renderPage({ [PROFILE]: [json(profile({ gender: 'woman' }))] });
      await form();
      expect(screen.getByRole('switch', { name: he.profile.about.switch })).toBeChecked();

      // Headings, by role: the index links repeat their text. Three parts (0010c).
      const h2s = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
      expect(h2s).toEqual([
        he.profile.about.title,
        he.profile.sections.search,
        he.profile.people.title,
        he.profile.delete.title, // the delete section, after the form (spec 0013f)
      ]);
      expect(
        screen.getByRole('heading', { level: 3, name: he.profile.sections.household }),
      ).toBeVisible();

      // The privacy line and the intro are in the head, outside the form.
      expect(screen.getByText(he.profile.privacy).closest('form')).toBeNull();
      expect(screen.getByText(he.profile.intro).closest('form')).toBeNull();

      // The index: the three parts and the questionnaire under "עליי", each target exists.
      const nav = screen.getByRole('navigation', { name: navName });
      const hrefs = () =>
        within(nav)
          .getAllByRole('link')
          .map((a) => a.getAttribute('href'));
      expect(hrefs()).toEqual([
        '#profile-about',
        '#profile-lifestyle',
        '#profile-looking',
        '#profile-people',
      ]);
      for (const href of hrefs()) expect(document.querySelector(String(href))).not.toBeNull();

      expect(names()).toEqual([
        'gender',
        'birth_year',
        'about_me',
        'lifestyle-cleanliness',
        'lifestyle-guests',
        'lifestyle-night',
        'lifestyle-social',
        'lifestyle-kosher',
        'lifestyle-shabbat',
        'lifestyle-work_from_home',
        'budget_max_ils',
        'move_in_date',
        'area_ids',
        'household',
        'contract_months',
        'parking_needed',
        'shelter_needed',
        'flatmate_gender',
      ]);

      // "עליי" off: the questionnaire's link and target are gone; the card switch waits for both.
      fireEvent.click(screen.getByRole('switch', { name: he.profile.about.switch }));
      expect(hrefs()).toEqual(['#profile-about', '#profile-looking', '#profile-people']);
      expect(document.querySelector('#profile-lifestyle')).toBeNull();
      expect(screen.queryByRole('switch', { name: he.profile.people.visible })).toBeNull();
      expect(screen.getByText(he.profile.people.needsBoth)).toBeVisible();
    });

    it('ac2_save_bar', async () => {
      // 200: the button and the saved line are in the bar, the form's last element child.
      renderPage({ [PROFILE]: [json(profile())] });
      await form();
      const bar = () => formEl().querySelector<HTMLElement>('[data-sticky-footer]') as HTMLElement;
      expect(formEl().lastElementChild).toBe(bar());
      expect(within(bar()).getByRole('button', { name: he.profile.save })).toHaveAttribute(
        'type',
        'submit',
      );
      save();
      await expectSaved();
      expect(within(bar()).getByRole('status')).toHaveTextContent(he.profile.saved);
      cleanup();

      // 500: the ErrorState is in the bar, and its retry re-sends the same body.
      const api = renderPage({
        [PROFILE]: [json(profile())],
        [PUT]: [json({}, 500), savedReply],
      });
      await form();
      save();
      const retry = await within(bar()).findByRole('button', { name: he.common.retry });
      expect(api.calls(PUT)).toHaveLength(1);
      fireEvent.click(retry);
      await vi.waitFor(() => {
        expect(api.calls(PUT)).toHaveLength(2);
      });
      expect(api.calls(PUT)[1]?.body).toStrictEqual(api.calls(PUT)[0]?.body);
      cleanup();

      // No areas: no bar.
      renderPage({ [AREAS]: [json([])] });
      expect(await screen.findByText(he.areas.empty)).toBeVisible();
      expect(document.querySelector('[data-sticky-footer]')).toBeNull();
    });

    it('ac3_load_errors_retry', async () => {
      const title = () => screen.getByRole('heading', { level: 1, name: he.profile.title });
      const pending = deferred();

      // Loading: the head shows, the privacy line is outside any form.
      let api = renderPage({ [PROFILE]: [pending.promise] });
      expect(
        await screen.findByRole('heading', { level: 1, name: he.profile.title }),
      ).toBeVisible();
      expect(screen.getByText(he.profile.privacy).closest('form')).toBeNull();
      pending.resolve(notFound());
      await form();
      cleanup();

      // GET /me/profile fails (not 401), GET /areas is fine: one ErrorState, no form; the retry
      // (now 200) shows the prefilled form.
      api = renderPage({ [PROFILE]: [json({}, 500), json(profile())] });
      expect(await screen.findByRole('button', { name: he.common.retry })).toBeVisible();
      expect(title()).toBeVisible();
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(screen.getByText(he.profile.privacy).closest('form')).toBeNull();
      expect(document.querySelector('form')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: he.common.retry }));
      await form();
      expect(budget()).toHaveValue(7500);
      expect(title()).toBeVisible();
      expect(api.calls(PROFILE)).toHaveLength(2);
      cleanup();

      // Both fail: one ErrorState, and its retry requests both again.
      api = renderPage({
        [PROFILE]: [json({}, 500), json({}, 500)],
        [AREAS]: [json({}, 500), json({}, 500)],
      });
      expect(await screen.findByRole('button', { name: he.common.retry })).toBeVisible();
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(title()).toBeVisible();
      expect(document.querySelector('form')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: he.common.retry }));
      await vi.waitFor(() => {
        expect(api.calls(PROFILE)).toHaveLength(2);
        expect(api.calls(AREAS)).toHaveLength(2);
      });
    });

    it('ac4_area_check_mark', async () => {
      renderPage();
      await form();
      const label = (area: AreaOut) =>
        (areaBox(area) as HTMLInputElement).labels?.[0] as HTMLLabelElement;
      const marks = (area: AreaOut) => label(area).querySelectorAll('svg[aria-hidden="true"]');
      for (const area of [gushDan, sharon]) {
        for (const cls of choiceSegment.split(' ')) expect(label(area)).toHaveClass(cls);
        expect(marks(area)).toHaveLength(0);
      }
      fireEvent.click(areaBox(gushDan));
      expect(marks(gushDan)).toHaveLength(1);
      expect(marks(sharon)).toHaveLength(0);
      fireEvent.click(areaBox(gushDan));
      expect(marks(gushDan)).toHaveLength(0);
    });
  });

  // Spec 0010c: "עליי" and "מה מחפשים", either alone or both; the card switch needs both.
  describe('ac11 two parts', () => {
    const aboutSwitch = () => toggle(he.profile.about.switch);
    const lookingSwitch = () => toggle(he.profile.looking.switch);
    const cardSwitch = () => screen.queryByRole('switch', { name: he.profile.people.visible });
    const needsBoth = () => screen.queryByText(he.profile.people.needsBoth);

    it('ac11 a 404 profile opens with "מה מחפשים" on and "עליי" off', async () => {
      renderPage();
      await form();
      expect(lookingSwitch()).toBeChecked();
      expect(aboutSwitch()).not.toBeChecked();
      expect(lookingSwitch()).toHaveAccessibleDescription(he.profile.looking.hint);
      expect(budget()).toBeVisible();
      expect(screen.queryByRole('group', { name: he.profile.room.fields.gender })).toBeNull();
      expect(cardSwitch()).toBeNull();
      expect(needsBoth()).toBeVisible();
    });

    it('ac11 a stored personal-only profile opens with "עליי" on and "מה מחפשים" off', async () => {
      const api = renderPage({ [PROFILE]: [json(personalOnlyProfile())] });
      await form();
      expect(aboutSwitch()).toBeChecked();
      expect(lookingSwitch()).not.toBeChecked();
      expect(radio(he.profile.room.fields.gender, he.profile.room.gender.woman)).toBeChecked();
      expect(screen.getByLabelText(he.profile.room.aboutMe)).toHaveValue('Quiet and tidy');
      expect(screen.queryByLabelText(he.profile.fields.budget)).toBeNull();
      expect(screen.queryByRole('group', { name: he.profile.fields.areas })).toBeNull();
      expect(cardSwitch()).toBeNull();
      expect(needsBoth()).toBeVisible();

      // Saving keeps the looking part empty, with its defaults.
      save();
      await expectSaved();
      expect(api.calls(PUT)[0]?.body).toStrictEqual({
        budget_max_ils: null,
        move_in_date: null,
        move_in_flexible: false,
        area_ids: null,
        household: null,
        has_pets: null,
        smoker: null,
        contract_months: null,
        parking_needed: 0,
        shelter_needed: 'any',
        gender: 'woman',
        birth_year: 1996,
        lifestyle: { night: 2 },
        about_me: 'Quiet and tidy',
        flatmate_gender: 'any',
        people_visible: false,
      });
    });

    it('ac11 the card switch only with both parts on, else the needs-both line', async () => {
      renderPage({ [PROFILE]: [json(profile({ gender: 'woman', people_visible: true }))] });
      await form();
      expect(cardSwitch()).toBeChecked();
      expect(needsBoth()).toBeNull();
      fireEvent.click(lookingSwitch());
      expect(cardSwitch()).toBeNull();
      expect(needsBoth()).toBeVisible();
      fireEvent.click(lookingSwitch());
      expect(cardSwitch()).toBeChecked();
      fireEvent.click(aboutSwitch());
      expect(cardSwitch()).toBeNull();
      expect(needsBoth()).toBeVisible();
    });

    it('ac11 looking off and on again restores what was typed; off and save clears it', async () => {
      const api = renderPage({ [PROFILE]: [json(profile({ gender: 'woman' }))] });
      await form();
      set(budget(), '9000');
      fireEvent.click(lookingSwitch());
      expect(screen.queryByLabelText(he.profile.fields.budget)).toBeNull();
      fireEvent.click(lookingSwitch());
      expect(budget()).toHaveValue(9000);
      fireEvent.click(lookingSwitch());
      save();
      await expectSaved();
      expect(api.calls(PUT)[0]?.body).toMatchObject({
        budget_max_ils: null,
        area_ids: null,
        parking_needed: 0,
        gender: 'woman',
      });
    });

    it('ac11 ?section=about&section=looking switches both on and focuses "עליי"', async () => {
      // No profile yet (the gate's case): both switch on, the first listed part focused.
      renderPage({}, '/me/profile?section=about&section=looking&next=%2Flistings%2Fabc');
      await form();
      expect(aboutSwitch()).toBeChecked();
      expect(lookingSwitch()).toBeChecked();
      const heading = screen.getByRole('heading', { level: 2, name: he.profile.about.title });
      await vi.waitFor(() => {
        expect(heading).toHaveFocus();
      });
      cleanup();

      // `section=looking` alone opens "מה מחפשים" on a personal-only profile and lands on it.
      renderPage(
        { [PROFILE]: [json(personalOnlyProfile())] },
        '/me/profile?section=looking&next=%2Flistings%2Fabc',
      );
      await form();
      expect(lookingSwitch()).toBeChecked();
      expect(aboutSwitch()).toBeChecked();
      const looking = screen.getByRole('heading', { level: 2, name: he.profile.sections.search });
      await vi.waitFor(() => {
        expect(looking).toHaveFocus();
      });
    });

    it('ac11 both off and save: the one-part alert, no request', async () => {
      const api = renderPage();
      await form();
      fireEvent.click(lookingSwitch());
      expect(aboutSwitch()).not.toBeChecked();
      save();
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(he.profile.errors.onePart);
      const bar = document.querySelector<HTMLElement>('[data-sticky-footer]');
      expect(bar).toContainElement(alert);
      expect(api.calls(PUT)).toHaveLength(0);

      // Switching a part on drops the alert; saving then checks that part.
      fireEvent.click(aboutSwitch());
      expect(screen.queryByText(he.profile.errors.onePart)).toBeNull();
      save();
      expectError(radio(he.profile.room.fields.gender, he.profile.room.gender.woman), required);
      expect(api.calls(PUT)).toHaveLength(0);
    });
  });

  describe('delete account (spec 0013f)', () => {
    const DELETE = 'DELETE /me';
    const LOGOUT = 'POST /auth/logout';

    function Landed() {
      return <output data-testid="landed">{useNavigationType()}</output>;
    }
    const tree = (
      <Routes>
        <Route element={<RequireSeeker />}>
          <Route path="/me/profile" element={<ProfilePage />} />
        </Route>
        <Route path="/account-deleted" element={<Landed />} />
        <Route path="/login" element={<p>login</p>} />
      </Routes>
    );
    const openDialog = async () => {
      await form();
      const opener = screen.getByRole('button', { name: he.profile.delete.open });
      opener.focus(); // a real click focuses it; fireEvent's does not
      fireEvent.click(opener);
      return screen.getByRole('dialog', { name: he.profile.delete.confirmTitle });
    };
    const confirmButton = (dialog: HTMLElement) =>
      within(dialog).getByRole('button', { name: he.profile.delete.confirm });

    it('ac1_delete_account', async () => {
      const client = testQueryClient();
      const gone = deferred();
      const api = renderPage({ [DELETE]: [gone.promise] }, '/me/profile', { client, tree });
      writeDraft('chat', 'c1', seeker.id, 'unsent');
      markSeen('listing-1');

      // The section sits after the form, with its link to what is kept.
      await form();
      const section = screen.getByRole('heading', { level: 2, name: he.profile.delete.title })
        .parentElement as HTMLElement;
      expect(section.closest('form')).toBeNull();
      expect(
        within(section).getByRole('link', { name: he.profile.delete.privacyLink }),
      ).toHaveAttribute('href', '/privacy#deletion');

      const dialog = await openDialog();
      // Cancel is focused first; confirming sends one request and disables the button.
      expect(within(dialog).getByRole('button', { name: he.common.cancel })).toHaveFocus();
      // A double click sends one request.
      fireEvent.click(confirmButton(dialog));
      fireEvent.click(confirmButton(dialog));
      const pending = await within(dialog).findByRole('button', {
        name: he.profile.delete.pending,
      });
      expect(pending).toBeDisabled();
      fireEvent.click(pending);
      expect(api.calls(DELETE)).toHaveLength(1);

      gone.resolve(empty());
      await vi.waitFor(() => {
        expect(currentPath()).toBe('/account-deleted');
      });
      // replace: Back does not return to the profile.
      expect(screen.getByTestId('landed')).toHaveTextContent('REPLACE');
      expect(readDraft('chat', 'c1', seeker.id)).toBe('');
      expect(readSeen().size).toBe(0);
      expect(client.getQueryData(ME_KEY)).toBeNull();
    });

    it('ac1_delete_resolves_after_the_page_is_gone', async () => {
      // Back, or a 401 bounce, unmounts the profile while DELETE is pending: the answer still
      // forgets the person on this device.
      const client = testQueryClient();
      const gone = deferred();
      const api = renderPage({ [DELETE]: [gone.promise] }, '/me/profile', { client, tree });
      writeDraft('chat', 'c1', seeker.id, 'unsent');
      markSeen('listing-1');
      const dialog = await openDialog();
      fireEvent.click(confirmButton(dialog));
      await vi.waitFor(() => {
        expect(api.calls(DELETE)).toHaveLength(1);
      });
      unmount();
      expect(client.getQueryData(ME_KEY)).not.toBeNull();

      gone.resolve(empty());
      await vi.waitFor(() => {
        expect(client.getQueryData(ME_KEY)).toBeNull();
      });
      expect(readDraft('chat', 'c1', seeker.id)).toBe('');
      expect(readSeen().size).toBe(0);
    });

    it('ac2_unauthenticated_is_reauth', async () => {
      renderPage({ [DELETE]: [() => json({ detail: 'unauthenticated' }, 401)] }, '/me/profile', {
        tree,
      });
      const dialog = await openDialog();
      fireEvent.click(confirmButton(dialog));
      expect(await within(dialog).findByText(he.profile.delete.reauth)).toBeVisible();
      expect(
        within(dialog).getByRole('button', { name: he.profile.delete.reauthAction }),
      ).toBeVisible();
    });

    it('ac2_reauth_logout_fails', async () => {
      const api = renderPage(
        {
          [DELETE]: [() => json({ detail: 'reauth_required' }, 403)],
          [LOGOUT]: [() => json({ detail: 'boom' }, 500)],
        },
        '/me/profile',
        { tree },
      );
      const dialog = await openDialog();
      fireEvent.click(confirmButton(dialog));
      fireEvent.click(
        await within(dialog).findByRole('button', { name: he.profile.delete.reauthAction }),
      );
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(he.common.error);
      expect(api.calls(LOGOUT)).toHaveLength(1);
      expect(currentPath()).toBe('/me/profile');
    });

    it('ac2_reauth_required', async () => {
      const client = testQueryClient();
      const api = renderPage(
        { [DELETE]: [() => json({ detail: 'reauth_required' }, 403)], [LOGOUT]: [() => empty()] },
        '/me/profile',
        { client, tree },
      );
      const dialog = await openDialog();
      fireEvent.click(confirmButton(dialog));
      expect(await within(dialog).findByText(he.profile.delete.reauth)).toBeVisible();
      expect(within(dialog).queryByRole('button', { name: he.profile.delete.confirm })).toBeNull();

      fireEvent.click(within(dialog).getByRole('button', { name: he.profile.delete.reauthAction }));
      await vi.waitFor(() => {
        expect(currentPath()).toBe('/login?next=%2Fme%2Fprofile');
      });
      expect(api.calls(LOGOUT)).toHaveLength(1);
      expect(client.getQueryData(ME_KEY)).toBeNull();
    });

    it('ac3_delete_failure_and_cancel', async () => {
      const api = renderPage(
        { [DELETE]: [() => json({ detail: 'boom' }, 500), networkError] },
        '/me/profile',
        { tree },
      );
      const dialog = await openDialog();

      // Any other failure: an alert, the dialog stays, the button is usable again.
      fireEvent.click(confirmButton(dialog));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(he.profile.delete.failed);
      expect(dialog).toHaveAttribute('open');
      expect(confirmButton(dialog)).toBeEnabled();

      // Offline, the request failing: "no connection" instead.
      const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      fireEvent.click(confirmButton(dialog));
      await vi.waitFor(() => {
        expect(within(dialog).getByRole('alert')).toHaveTextContent(he.common.offline);
      });
      onLine.mockRestore();
      expect(api.calls(DELETE)).toHaveLength(2);

      // Cancel closes it, sends nothing and returns focus to the opener.
      fireEvent.click(within(dialog).getByRole('button', { name: he.common.cancel }));
      await vi.waitFor(() => {
        expect(dialog).not.toHaveAttribute('open');
      });
      expect(screen.getByRole('button', { name: he.profile.delete.open })).toHaveFocus();
      expect(api.calls(DELETE)).toHaveLength(2);
      expect(currentPath()).toBe('/me/profile');
    });
  });
});
