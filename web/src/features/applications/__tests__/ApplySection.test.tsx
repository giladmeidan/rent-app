import { act, cleanup as unmount, fireEvent, screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
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
import { LoginPage } from '../../auth/LoginPage';
import { ListingPage } from '../../listings/ListingPage';
import { owner, seeker } from '../../listings/__tests__/fixtures';
import { profile } from '../../profile/__tests__/fixtures';
import { listingDetail } from '../../search/__tests__/fixtures';
import type { MyApplicationOut } from '../api';
import { MY_APPLICATIONS_KEY } from '../useMyApplications';
import { application } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const LISTING = 'GET /listings/A';
const MINE = 'GET /me/applications';
const APPLY = 'POST /listings/A/applications';
const PROFILE = 'GET /me/profile';
const NEXT = '%2Flistings%2FA';
const MESSAGE = 'Hi, we are a quiet couple';

type Reply = Parameters<typeof mockApi>[0][string][number];

const unauthenticated = () => json({ detail: 'unauthenticated' }, 401);
const listingReply =
  (applicant_count = 0) =>
  () =>
    json(listingDetail({ id: 'A', applicant_count }));

const routes = (
  <Routes>
    <Route path="/listings/:id" element={<ListingPage />} />
    <Route path="/login" element={<LoginPage />} />
    <Route path="/me/applications" element={<p>mine</p>} />
  </Routes>
);

const renderListing = (client = testQueryClient()) => renderRoutes('/listings/A', routes, client);

/** The apply section, once the listing has loaded. */
async function section() {
  return within(await screen.findByRole('region', { name: he.applications.heading }));
}

/** Waits for `/me` (and the seeker's list) to settle: the section's skeleton is gone. */
async function settled() {
  const s = await section();
  await vi.waitFor(() => {
    expect(s.queryByTestId('skeleton')).toBeNull();
  });
  return s;
}

const countText = (count: number) => i18n.t('applications.count', { count });
const appliedText = (app: MyApplicationOut) =>
  i18n.t('applications.applied', {
    date: new Intl.DateTimeFormat('he-IL', {
      day: 'numeric',
      month: 'numeric',
      year: '2-digit',
      timeZone: 'Asia/Jerusalem',
    }).format(new Date(app.created_at)),
  });
const charsLeft = (count: number) => i18n.t('listings.fields.charsLeft', { count });

/** A seeker on `/listings/A` whose `GET /me/applications` answers `mine`. */
function renderSeeker(
  mine: Reply[],
  extra: Record<string, Reply[]> = {},
  count = 0,
  client = testQueryClient(),
) {
  const api = mockApi({
    'GET /me': [json(seeker)],
    [LISTING]: [listingReply(count)],
    [MINE]: mine,
    [PROFILE]: [json(profile())],
    ...extra,
  });
  renderListing(client);
  return api;
}

/** Opens the form and returns the textarea. */
async function openForm() {
  const s = await settled();
  fireEvent.click(s.getByRole('button', { name: he.applications.apply }));
  return s.getByRole('textbox', { name: he.applications.form.label });
}

function type(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
}

const submit = () => screen.getByRole('button', { name: he.applications.form.submit });

/** Clicks submit as a pointer does: the button takes focus first. */
function send() {
  submit().focus();
  fireEvent.click(submit());
}

/** The ids in `el`'s `aria-describedby`. */
const describedBy = (el: HTMLElement) => (el.getAttribute('aria-describedby') ?? '').split(' ');

/** Unmounts the current render and drops its fetch mock. */
function cleanup() {
  unmount();
  vi.unstubAllGlobals();
}

describe('ApplySection', () => {
  it('ac1_applicant_count', async () => {
    const viewers = [
      () => ({ 'GET /me': [unauthenticated()] }),
      () => ({ 'GET /me': [json(owner)] }),
      () => ({ 'GET /me': [json(seeker)], [MINE]: [json([])], [PROFILE]: [json(profile())] }),
    ];
    for (const count of [0, 1, 12]) {
      for (const viewer of viewers) {
        mockApi({ [LISTING]: [listingReply(count)], ...viewer() });
        const view = renderListing();
        const s = await settled();
        expect(s.getByText(countText(count))).toBeVisible();
        view.unmount();
        vi.unstubAllGlobals();
      }
    }
  });

  it('ac3_applicant_count_forms', async () => {
    const forms: [number, string][] = [
      [
        0,
        '\u05e2\u05d5\u05d3 \u05d0\u05d9\u05df \u05de\u05d5\u05e2\u05de\u05d3\u05d9\u05dd. \u05d0\u05e4\u05e9\u05e8 \u05dc\u05d4\u05d9\u05d5\u05ea \u05d4\u05e8\u05d0\u05e9\u05d5\u05e0\u05d9\u05dd',
      ],
      [
        1,
        '\u05d4\u05d5\u05d2\u05e9\u05d4 \u05de\u05d5\u05e2\u05de\u05d3\u05d5\u05ea \u05d0\u05d7\u05ea',
      ],
      [
        2,
        '2 \u05de\u05d5\u05e2\u05de\u05d3\u05d9\u05dd \u05d4\u05d2\u05d9\u05e9\u05d5 \u05de\u05d5\u05e2\u05de\u05d3\u05d5\u05ea',
      ],
      [
        7,
        '7 \u05de\u05d5\u05e2\u05de\u05d3\u05d9\u05dd \u05d4\u05d2\u05d9\u05e9\u05d5 \u05de\u05d5\u05e2\u05de\u05d3\u05d5\u05ea',
      ],
    ];
    for (const [count, text] of forms) {
      mockApi({ [LISTING]: [listingReply(count)], 'GET /me': [unauthenticated()] });
      const view = renderListing();
      const s = await settled();
      expect(s.getByText(text)).toBeVisible();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac2_visitor_prompt_owner_hidden', async () => {
    for (const me of [unauthenticated, networkError]) {
      const api = mockApi({ 'GET /me': [me], [LISTING]: [listingReply()] });
      const view = renderListing();
      const s = await settled();
      expect(s.getByText(he.applications.loginPrompt)).toBeVisible();
      expect(s.getByRole('link', { name: he.header.login })).toHaveAttribute(
        'href',
        `/login?next=${NEXT}`,
      );
      expect(s.getByRole('link', { name: he.header.signup })).toHaveAttribute(
        'href',
        `/signup?role=seeker&next=${NEXT}`,
      );
      expect(s.queryByRole('button', { name: he.applications.apply })).toBeNull();
      expect(api.calls(MINE)).toHaveLength(0);
      view.unmount();
      vi.unstubAllGlobals();
    }

    const api = mockApi({ 'GET /me': [json(owner)], [LISTING]: [listingReply()] });
    renderListing();
    const s = await settled();
    expect(s.getByText(countText(0))).toBeVisible();
    expect(s.queryByText(he.applications.loginPrompt)).toBeNull();
    expect(s.queryByRole('button', { name: he.applications.apply })).toBeNull();
    expect(s.queryByRole('textbox')).toBeNull();
    expect(api.calls('GET /me')).toHaveLength(1);
    expect(api.calls(MINE)).toHaveLength(0);
  });

  it('ac3_seeker_applies', async () => {
    const post = deferred();
    const api = renderSeeker([json([])], { [APPLY]: [post.promise] });

    const field = await openForm();
    const button = screen.getByRole('button', { name: he.applications.apply });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button.getAttribute('aria-controls')).toBe(field.closest('form')?.id);
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute('maxlength', '500');
    expect(screen.getByText(charsLeft(500))).toBeVisible();

    // Blank after trim: an error, no request.
    type(field, '   ');
    fireEvent.click(submit());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(he.listings.errors.required);
    expect(describedBy(field)).toContain(alert.id);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(api.calls(APPLY)).toHaveLength(0);

    // A double click sends one trimmed request.
    type(field, `  ${MESSAGE}  `);
    fireEvent.click(submit());
    fireEvent.click(submit());
    await vi.waitFor(() => {
      expect(api.calls(APPLY)).toHaveLength(1);
    });
    const [call] = api.calls(APPLY);
    expect(call?.body).toEqual({ message: MESSAGE });
    expect(call?.request.credentials).toBe('include');
    expect(submit()).toBeDisabled();
    expect(submit()).toHaveAttribute('aria-busy', 'true');

    // 201: sent, the applied state and the new count, with no second listing request.
    const sent = application();
    post.resolve(json(sent, 201));
    const s = await section();
    expect(await s.findByRole('status')).toHaveTextContent(he.applications.sent);
    expect(s.getByText(appliedText(sent))).toBeVisible();
    expect(s.getByText(he.applications.status.submitted)).toBeVisible();
    expect(s.getByRole('link', { name: he.applications.viewMine })).toHaveAttribute(
      'href',
      '/me/applications',
    );
    expect(s.queryByRole('button', { name: he.applications.apply })).toBeNull();
    expect(s.queryByRole('textbox')).toBeNull();
    expect(s.getByText(countText(1))).toBeVisible();
    expect(s.queryByText(countText(0))).toBeNull();
    expect(api.calls(LISTING)).toHaveLength(1);
    expect(api.calls(APPLY)).toHaveLength(1);
    cleanup();

    // A separate render: cancel closes and clears the form and returns focus to the button.
    renderSeeker([json([])]);
    type(await openForm(), 'x');
    fireEvent.click(screen.getByRole('button', { name: he.applications.form.cancel }));
    expect(screen.queryByRole('textbox')).toBeNull();
    const reopen = screen.getByRole('button', { name: he.applications.apply });
    expect(reopen).toHaveAttribute('aria-expanded', 'false');
    expect(reopen).toHaveFocus();

    fireEvent.click(reopen);
    expect(screen.getByRole('textbox', { name: he.applications.form.label })).toHaveValue('');
  });

  it('ac4_apply_errors', async () => {
    // 409 already_applied: the list is refetched and shows the applied state.
    const existing = application({ status: 'submitted' });
    let api = renderSeeker([json([]), json([existing])], {
      [APPLY]: [json({ detail: 'already_applied' }, 409)],
    });
    type(await openForm(), MESSAGE);
    send();
    const s = await section();
    expect(await s.findByText(appliedText(existing))).toBeVisible();
    expect(s.queryByRole('textbox')).toBeNull();
    expect(api.calls(MINE)).toHaveLength(2);
    cleanup();

    // 429: the rate-limit copy, the text kept.
    renderSeeker([json([])], { [APPLY]: [json({ detail: 'rate_limited' }, 429)] });
    let field = await openForm();
    type(field, MESSAGE);
    send();
    const limited = await screen.findByRole('alert');
    expect(limited).toHaveTextContent(he.applications.errors.rateLimited);
    expect(field).toHaveValue(MESSAGE);
    expect(describedBy(field)).toContain(limited.id);
    expect(field).toHaveFocus();
    cleanup();

    // 404: the listing no longer takes applications; the form is gone.
    renderSeeker([json([])], { [APPLY]: [json({ detail: 'not_found' }, 404)] });
    type(await openForm(), MESSAGE);
    send();
    expect(await screen.findByRole('alert')).toHaveTextContent(he.applications.errors.unavailable);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: he.applications.form.submit })).toBeNull();
    cleanup();

    // 422 at body.message: the field's own error; the API's English `msg` is never shown.
    const msg = 'message contains control or invisible characters';
    renderSeeker([json([])], {
      [APPLY]: [json({ detail: [{ loc: ['body', 'message'], type: 'value_error', msg }] }, 422)],
    });
    field = await openForm();
    type(field, MESSAGE);
    send();
    const invalid = await screen.findByRole('alert');
    expect(invalid).toHaveTextContent(he.listings.errors.invalid);
    expect(describedBy(field)).toContain(invalid.id);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(document.body.textContent).not.toContain(msg);
    cleanup();

    // 401: the session is forgotten, so /login renders its form instead of bouncing back.
    renderSeeker([json([])], { [APPLY]: [unauthenticated()] });
    type(await openForm(), MESSAGE);
    send();
    await vi.waitFor(() => {
      expect(currentPath()).toBe(`/login?next=${NEXT}`);
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: he.auth.login.title }),
    ).toBeVisible();
    // Still there a moment later: no redirect back to the listing.
    await new Promise((r) => setTimeout(r, 50));
    expect(currentPath()).toBe(`/login?next=${NEXT}`);
    cleanup();

    // 403: the generic error, focus back on the textarea.
    renderSeeker([json([])], { [APPLY]: [json({ detail: 'seeker_only' }, 403)] });
    field = await openForm();
    type(field, MESSAGE);
    send();
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    expect(field).toHaveFocus();
    cleanup();

    // Network error: the generic error with retry, which re-sends the same body.
    api = renderSeeker([json([])], {
      [APPLY]: [networkError, () => json(application({ status: 'submitted' }), 201)],
    });
    field = await openForm();
    type(field, `  ${MESSAGE} `);
    send();
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    expect(field).toHaveFocus();
    // Editing the text drops the server error, so retry only ever re-sends an unchanged body.
    type(field, `${MESSAGE}!`);
    expect(screen.queryByRole('button', { name: he.common.retry })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(api.calls(APPLY)).toHaveLength(1);
    cleanup();

    api = renderSeeker([json([])], {
      [APPLY]: [networkError, () => json(application({ status: 'submitted' }), 201)],
    });
    type(await openForm(), `  ${MESSAGE} `);
    send();
    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    fireEvent.click(screen.getByRole('button', { name: he.common.retry }));
    expect(await (await section()).findByRole('status')).toHaveTextContent(he.applications.sent);
    expect(api.calls(APPLY).map((c) => c.body)).toEqual([
      { message: MESSAGE },
      { message: MESSAGE },
    ]);
  });

  it('ac5_existing_application_states', async () => {
    for (const status of ['submitted', 'shortlisted', 'declined'] as const) {
      const app = application({ status });
      renderSeeker([json([app])]);
      const s = await settled();
      expect(s.getByText(appliedText(app))).toBeVisible();
      expect(s.getByTestId('application-status')).toHaveTextContent(he.applications.status[status]);
      if (status === 'declined') expect(s.getByText(he.applications.declinedHint)).toBeVisible();
      else expect(s.queryByText(he.applications.declinedHint)).toBeNull();
      expect(s.getByRole('link', { name: he.applications.viewMine })).toHaveAttribute(
        'href',
        '/me/applications',
      );
      expect(s.queryByRole('button', { name: he.applications.apply })).toBeNull();
      cleanup();
    }

    // Withdrawn: the apply button is back, and re-applying runs the AC3 flow.
    const withdrawn = application({ status: 'withdrawn' });
    const reopened: MyApplicationOut = { ...withdrawn, status: 'submitted' };
    let api = renderSeeker([json([withdrawn])], { [APPLY]: [json(reopened, 201)] }, 3);
    type(await openForm(), MESSAGE);
    fireEvent.click(submit());
    expect(await (await section()).findByRole('status')).toHaveTextContent(he.applications.sent);
    let s = await section();
    expect(s.getByTestId('application-status')).toHaveTextContent(he.applications.status.submitted);
    expect(s.getByText(countText(4))).toBeVisible();
    expect(api.calls(APPLY).map((c) => c.body)).toEqual([{ message: MESSAGE }]);
    cleanup();

    // The list pending: a busy skeleton in the section, the count line already there.
    const pending = deferred();
    renderSeeker([pending.promise]);
    s = await section();
    expect(s.getByText(countText(0))).toBeVisible();
    expect(s.getByTestId('skeleton').closest('[aria-busy="true"]')).not.toBeNull();
    expect(s.queryByRole('button', { name: he.applications.apply })).toBeNull();
    cleanup();

    // The list fails: ErrorState; retry refetches it.
    api = renderSeeker([json({ detail: 'boom' }, 500), json([])]);
    s = await section();
    fireEvent.click(await s.findByRole('button', { name: he.common.retry }));
    expect(await s.findByRole('button', { name: he.applications.apply })).toBeVisible();
    expect(api.calls(MINE)).toHaveLength(2);
    cleanup();

    // A background refetch of the list fails: the cached list stays, so the open form and the
    // seeker's draft survive (no ErrorState).
    let client = testQueryClient();
    api = renderSeeker([json([]), networkError], {}, 0, client);
    let field = await openForm();
    type(field, MESSAGE);
    await act(async () => {
      await client.refetchQueries({ queryKey: ['me', 'applications'] });
      // TanStack notifies observers on a timeout; let the error reach the section.
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(api.calls(MINE)).toHaveLength(2);
    expect(client.getQueryState(['me', 'applications'])?.status).toBe('error');
    s = await section();
    expect(s.getByRole('textbox', { name: he.applications.form.label })).toHaveValue(MESSAGE);
    expect(s.queryByRole('button', { name: he.common.retry })).toBeNull();
    cleanup();

    // A background refetch of /me fails: the cached seeker stays logged in, form and draft kept.
    client = testQueryClient();
    api = renderSeeker([json([])], { 'GET /me': [json(seeker), networkError] }, 0, client);
    field = await openForm();
    type(field, MESSAGE);
    await act(async () => {
      await client.refetchQueries({ queryKey: ['me'], exact: true });
      // TanStack notifies observers on a timeout; let the error reach the section.
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(api.calls('GET /me')).toHaveLength(2);
    expect(client.getQueryState(['me'])?.status).toBe('error');
    s = await section();
    expect(s.queryByText(he.applications.loginPrompt)).toBeNull();
    expect(s.getByRole('textbox', { name: he.applications.form.label })).toHaveValue(MESSAGE);
    cleanup();

    // The list answers 401: the session is gone; the visitor prompt.
    renderSeeker([unauthenticated()]);
    s = await section();
    expect(await s.findByText(he.applications.loginPrompt)).toBeVisible();
    expect(s.getByRole('link', { name: he.header.login })).toHaveAttribute(
      'href',
      `/login?next=${NEXT}`,
    );
  });
  it('ac7_profile_gate', async () => {
    const noProfile = () => json({ detail: 'seeker_profile_not_found' }, 404);
    const gateLink = (s: ReturnType<typeof within>) =>
      s.getByRole('link', { name: he.applications.fillProfile });

    // No profile: the gate, no apply button.
    let api = renderSeeker([json([])], { [PROFILE]: [noProfile()] });
    let s = await settled();
    expect(await s.findByText(he.applications.profileRequired)).toBeVisible();
    expect(gateLink(s)).toHaveAttribute('href', `/me/profile?next=${NEXT}`);
    expect(s.queryByRole('button', { name: he.applications.apply })).toBeNull();
    expect(api.calls(PROFILE)).toHaveLength(1);
    expect(api.calls(PROFILE)[0]?.request.credentials).toBe('include');
    cleanup();

    // A profile: the apply button as today, no gate.
    renderSeeker([json([])]);
    s = await settled();
    expect(s.getByRole('button', { name: he.applications.apply })).toBeVisible();
    expect(s.queryByText(he.applications.profileRequired)).toBeNull();
    cleanup();

    // The profile pending: the busy skeleton, neither the gate nor the button.
    const pending = deferred();
    api = renderSeeker([json([])], { [PROFILE]: [pending.promise] });
    s = await section();
    await vi.waitFor(() => {
      expect(api.calls(MINE)).toHaveLength(1);
      expect(api.calls(PROFILE)).toHaveLength(1);
    });
    expect(s.getByTestId('skeleton').closest('[aria-busy="true"]')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(s.getByTestId('skeleton')).toBeInTheDocument();
    expect(s.queryByRole('button', { name: he.applications.apply })).toBeNull();
    expect(s.queryByText(he.applications.profileRequired)).toBeNull();
    cleanup();

    // The profile fails: ErrorState; retry sends a second GET /me/profile.
    api = renderSeeker([json([])], { [PROFILE]: [json({ detail: 'boom' }, 500), json(profile())] });
    s = await section();
    fireEvent.click(await s.findByRole('button', { name: he.common.retry }));
    expect(await s.findByRole('button', { name: he.applications.apply })).toBeVisible();
    expect(api.calls(PROFILE)).toHaveLength(2);
    cleanup();

    // The profile answers 401: the session is gone; the visitor prompt.
    renderSeeker([json([])], { [PROFILE]: [unauthenticated()] });
    s = await section();
    expect(await s.findByText(he.applications.loginPrompt)).toBeVisible();
    expect(s.queryByText(he.applications.profileRequired)).toBeNull();
    cleanup();

    // A shortlisted application: the applied state, whether the profile is pending or missing.
    const shortlisted = application({ status: 'shortlisted' });
    for (const reply of [deferred().promise, noProfile()]) {
      renderSeeker([json([shortlisted])], { [PROFILE]: [reply] });
      s = await section();
      expect(await s.findByText(appliedText(shortlisted))).toBeVisible();
      expect(s.queryByTestId('skeleton')).toBeNull();
      expect(s.queryByText(he.applications.profileRequired)).toBeNull();
      cleanup();
    }

    // A withdrawn application and no profile: the gate.
    renderSeeker([json([application({ status: 'withdrawn' })])], { [PROFILE]: [noProfile()] });
    s = await section();
    expect(await s.findByText(he.applications.profileRequired)).toBeVisible();
    expect(s.queryByRole('button', { name: he.applications.apply })).toBeNull();
    cleanup();

    // A visitor and an owner never request the profile.
    for (const me of [unauthenticated(), json(owner)]) {
      api = mockApi({ 'GET /me': [me], [LISTING]: [listingReply()], [PROFILE]: [noProfile()] });
      renderListing();
      await settled();
      await new Promise((r) => setTimeout(r, 20));
      expect(api.calls(PROFILE)).toHaveLength(0);
      cleanup();
    }
  });

  it('ac8_409_seeker_profile_required_refetches_profile', async () => {
    // A cached profile, then the API says there is none: the profile is refetched and the gate
    // replaces the form; the list is not refetched.
    let api = renderSeeker([json([])], {
      [PROFILE]: [json(profile()), json({ detail: 'seeker_profile_not_found' }, 404)],
      [APPLY]: [json({ detail: 'seeker_profile_required' }, 409)],
    });
    type(await openForm(), MESSAGE);
    send();
    const s = await section();
    expect(await s.findByText(he.applications.profileRequired)).toBeVisible();
    expect(s.queryByRole('textbox')).toBeNull();
    expect(s.queryByRole('button', { name: he.applications.apply })).toBeNull();
    expect(s.queryByRole('alert')).toBeNull();
    expect(api.calls(PROFILE)).toHaveLength(2);
    expect(api.calls(MINE)).toHaveLength(1);
    cleanup();

    // 409 already_applied: the list is refetched, the profile is not.
    const existing = application({ status: 'submitted' });
    api = renderSeeker([json([]), json([existing])], {
      [APPLY]: [json({ detail: 'already_applied' }, 409)],
    });
    type(await openForm(), MESSAGE);
    send();
    expect(await (await section()).findByText(appliedText(existing))).toBeVisible();
    expect(api.calls(MINE)).toHaveLength(2);
    expect(api.calls(PROFILE)).toHaveLength(1);
  });

  it('ac8_room_misfit', async () => {
    const MISFIT = 'החדר לא מתאים לפרטים שבפרופיל שלך, ולכן אי אפשר להגיש אליו מועמדות.';
    const room = (overrides: Parameters<typeof listingDetail>[0] = {}) => [
      () =>
        json(listingDetail({ id: 'A', listing_type: 'room', flatmates_count: 2, ...overrides })),
    ];
    const noControls = (s: ReturnType<typeof within>) => {
      expect(s.queryByRole('button', { name: he.applications.apply })).toBeNull();
      expect(s.queryByRole('textbox')).toBeNull();
      expect(s.queryByText(he.applications.profileRequired)).toBeNull();
      expect(s.queryByRole('link', { name: he.rooms.apply.fillRoomSection })).toBeNull();
    };

    // `room_fit: false`: the line, no button, no form, no gate, even while the profile is pending.
    const pending = deferred();
    const api = renderSeeker([json([])], {
      [LISTING]: room({ gender_preference: 'women', room_fit: false }),
      [PROFILE]: [pending.promise],
    });
    let s = await settled();
    expect(s.getByText(MISFIT)).toBeVisible();
    expect(s.getByText(countText(0))).toBeVisible();
    noControls(s);
    expect(s.queryByTestId('skeleton')).toBeNull();
    expect(api.calls(PROFILE)).toHaveLength(1);
    cleanup();

    // A profile that cannot be read changes nothing either.
    renderSeeker([json([])], {
      [LISTING]: room({ room_fit: false }),
      [PROFILE]: [json({ detail: 'boom' }, 500)],
    });
    s = await settled();
    expect(s.getByText(MISFIT)).toBeVisible();
    expect(s.queryByRole('button', { name: he.common.retry })).toBeNull();
    noControls(s);
    cleanup();

    // `room_fit: true`, or `null` on an `any` room: the apply button.
    for (const fit of [true, null]) {
      renderSeeker([json([])], { [LISTING]: room({ gender_preference: 'any', room_fit: fit }) });
      s = await settled();
      expect(await s.findByRole('button', { name: he.applications.apply })).toBeVisible();
      expect(s.queryByText(MISFIT)).toBeNull();
      cleanup();
    }

    // An apartment (`room_fit: null`) is unchanged.
    renderSeeker([json([])]);
    s = await settled();
    expect(await s.findByRole('button', { name: he.applications.apply })).toBeVisible();
    expect(s.queryByText(MISFIT)).toBeNull();
    cleanup();

    // Already applied: the applied state, not the line.
    const live = application({ status: 'submitted' });
    renderSeeker([json([live])], { [LISTING]: room({ room_fit: false }) });
    s = await settled();
    expect(await s.findByText(appliedText(live))).toBeVisible();
    expect(s.queryByText(MISFIT)).toBeNull();
  });

  it('ac9_room_section_gate', async () => {
    const GATE =
      'החדר מיועד לנשים בלבד. כדי להגיש מועמדות צריך להשלים בפרופיל את החלק ״חדר בדירת שותפים״.';
    const noProfile = () => json({ detail: 'seeker_profile_not_found' }, 404);
    const room = (gender_preference: 'any' | 'women') => [
      () =>
        json(listingDetail({ id: 'A', listing_type: 'room', gender_preference, room_fit: null })),
    ];

    // A women-only room, and a profile without the room section, or no profile at all: the gate.
    for (const reply of [json(profile({ gender: null })), noProfile()]) {
      renderSeeker([json([])], { [LISTING]: room('women'), [PROFILE]: [reply] });
      const s = await settled();
      expect(await s.findByText(GATE)).toBeVisible();
      expect(s.getByRole('link', { name: he.rooms.apply.fillRoomSection })).toHaveAttribute(
        'href',
        `/me/profile?section=room&next=${NEXT}`,
      );
      expect(s.queryByRole('button', { name: he.applications.apply })).toBeNull();
      expect(s.queryByText(he.applications.profileRequired)).toBeNull();
      expect(s.queryByRole('link', { name: he.applications.fillProfile })).toBeNull();
      cleanup();
    }

    // The same room and a woman's room section: the apply button.
    renderSeeker([json([])], {
      [LISTING]: room('women'),
      [PROFILE]: [json(profile({ gender: 'woman' }))],
    });
    let s = await settled();
    expect(await s.findByRole('button', { name: he.applications.apply })).toBeVisible();
    expect(s.queryByText(GATE)).toBeNull();
    cleanup();

    // An `any` room never asks for the room section; with no profile, today's gate.
    renderSeeker([json([])], {
      [LISTING]: room('any'),
      [PROFILE]: [json(profile({ gender: null }))],
    });
    s = await settled();
    expect(await s.findByRole('button', { name: he.applications.apply })).toBeVisible();
    expect(s.queryByRole('link', { name: he.rooms.apply.fillRoomSection })).toBeNull();
    cleanup();
    renderSeeker([json([])], { [LISTING]: room('any'), [PROFILE]: [noProfile()] });
    s = await settled();
    expect(await s.findByText(he.applications.profileRequired)).toBeVisible();
    expect(s.queryByRole('link', { name: he.rooms.apply.fillRoomSection })).toBeNull();
  });

  it('ac10_room_409s', async () => {
    const MISFIT = 'החדר לא מתאים לפרטים שבפרופיל שלך, ולכן אי אפשר להגיש אליו מועמדות.';
    const GATE =
      'החדר מיועד לנשים בלבד. כדי להגיש מועמדות צריך להשלים בפרופיל את החלק ״חדר בדירת שותפים״.';
    const room = (gender_preference: 'any' | 'women') => () =>
      json(listingDetail({ id: 'A', listing_type: 'room', gender_preference, room_fit: null }));
    const noBanners = (s: ReturnType<typeof within>) => {
      expect(s.queryByRole('alert')).toBeNull();
      expect(s.queryByText(he.applications.errors.rateLimited)).toBeNull();
      expect(s.queryByRole('button', { name: he.common.retry })).toBeNull();
    };

    // 409 room_gender_mismatch: the misfit line at once, from the cache (no new listing request).
    const client = testQueryClient();
    let api = renderSeeker(
      [json([])],
      {
        [LISTING]: [room('any')],
        [PROFILE]: [json(profile({ gender: 'man', flatmate_gender: 'women' }))],
        [APPLY]: [json({ detail: 'room_gender_mismatch' }, 409)],
      },
      0,
      client,
    );
    type(await openForm(), MESSAGE);
    send();
    let s = await section();
    expect(await s.findByText(MISFIT)).toBeVisible();
    expect(s.queryByRole('textbox')).toBeNull();
    expect(s.queryByRole('button', { name: he.applications.apply })).toBeNull();
    noBanners(s);
    expect(client.getQueryData<{ room_fit: boolean | null }>(['listing', 'A'])?.room_fit).toBe(
      false,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(api.calls(LISTING)).toHaveLength(1);
    cleanup();

    // 409 seeker_gender_required: the cached room said `any`, the owner has made it women-only
    // since. The profile and the listing are both refetched, and the room-section gate shows.
    api = renderSeeker([json([])], {
      [LISTING]: [room('any'), room('women')],
      [PROFILE]: [json(profile({ gender: null }))],
      [APPLY]: [json({ detail: 'seeker_gender_required' }, 409)],
    });
    type(await openForm(), MESSAGE);
    send();
    s = await section();
    expect(await s.findByText(GATE)).toBeVisible();
    expect(s.queryByRole('textbox')).toBeNull();
    expect(s.queryByRole('button', { name: he.applications.apply })).toBeNull();
    noBanners(s);
    expect(api.calls(PROFILE)).toHaveLength(2);
    expect(api.calls(LISTING)).toHaveLength(2);
    expect(api.calls(MINE)).toHaveLength(1);
  });

  it('ac1_focus_after_submit_outcomes', async () => {
    const MISFIT = i18n.t('rooms.apply.misfit');
    const room =
      (overrides: Parameters<typeof listingDetail>[0] = {}) =>
      () =>
        json(listingDetail({ id: 'A', listing_type: 'room', flatmates_count: 2, ...overrides }));
    /** The paragraph that opens the gate whose link is `link`. */
    const gateLine = async (link: string) => {
      const found = await (await section()).findByRole('link', { name: link });
      const line = found.parentElement?.querySelector('p');
      if (line === null || line === undefined) throw new Error('no gate line');
      return line;
    };

    // 201: the "sent" status line.
    renderSeeker([json([])], { [APPLY]: [json(application(), 201)] });
    type(await openForm(), MESSAGE);
    send();
    const sentLine = await (await section()).findByRole('status');
    expect(sentLine).toHaveTextContent(he.applications.sent);
    await vi.waitFor(() => {
      expect(sentLine).toHaveFocus();
    });
    cleanup();

    // 409 room_gender_mismatch: the misfit line.
    renderSeeker([json([])], {
      [LISTING]: [room({ gender_preference: 'any', room_fit: null })],
      [PROFILE]: [json(profile({ gender: 'man', flatmate_gender: 'women' }))],
      [APPLY]: [json({ detail: 'room_gender_mismatch' }, 409)],
    });
    type(await openForm(), MESSAGE);
    send();
    const misfit = await (await section()).findByText(MISFIT);
    await vi.waitFor(() => {
      expect(misfit).toHaveFocus();
    });
    cleanup();

    // 409 seeker_gender_required, the listing refetch answering a women-only room: the room
    // gate's paragraph.
    renderSeeker([json([])], {
      [LISTING]: [
        room({ gender_preference: 'any', room_fit: null }),
        room({ gender_preference: 'women', room_fit: null }),
      ],
      [PROFILE]: [json(profile({ gender: null }))],
      [APPLY]: [json({ detail: 'seeker_gender_required' }, 409)],
    });
    type(await openForm(), MESSAGE);
    send();
    const roomGate = await gateLine(he.rooms.apply.fillRoomSection);
    await vi.waitFor(() => {
      expect(roomGate).toHaveFocus();
    });
    cleanup();

    // The same, the listing refetch answering `room_fit: false`: the misfit line.
    renderSeeker([json([])], {
      [LISTING]: [
        room({ gender_preference: 'any', room_fit: null }),
        room({ gender_preference: 'women', room_fit: false }),
      ],
      [PROFILE]: [json(profile({ gender: null }))],
      [APPLY]: [json({ detail: 'seeker_gender_required' }, 409)],
    });
    type(await openForm(), MESSAGE);
    send();
    const refetchedMisfit = await (await section()).findByText(MISFIT);
    await vi.waitFor(() => {
      expect(refetchedMisfit).toHaveFocus();
    });
    cleanup();

    // 409 seeker_profile_required: the profile gate's paragraph.
    renderSeeker([json([])], {
      [PROFILE]: [json(profile()), json({ detail: 'seeker_profile_not_found' }, 404)],
      [APPLY]: [json({ detail: 'seeker_profile_required' }, 409)],
    });
    type(await openForm(), MESSAGE);
    send();
    const profileGate = await gateLine(he.applications.fillProfile);
    expect(profileGate).toHaveTextContent(he.applications.profileRequired);
    await vi.waitFor(() => {
      expect(profileGate).toHaveFocus();
    });
    cleanup();

    // 409 already_applied: the applied block's first line (not the "sent" line).
    const existing = application({ status: 'submitted' });
    renderSeeker([json([]), json([existing])], {
      [APPLY]: [json({ detail: 'already_applied' }, 409)],
    });
    type(await openForm(), MESSAGE);
    send();
    const appliedLine = await (await section()).findByText(appliedText(existing));
    await vi.waitFor(() => {
      expect(appliedLine).toHaveFocus();
    });
    expect(screen.queryByText(he.applications.sent)).toBeNull();
    cleanup();

    // 404: the unavailable alert.
    renderSeeker([json([])], { [APPLY]: [json({ detail: 'not_found' }, 404)] });
    type(await openForm(), MESSAGE);
    send();
    const unavailable = await screen.findByRole('alert');
    expect(unavailable).toHaveTextContent(he.applications.errors.unavailable);
    await vi.waitFor(() => {
      expect(unavailable).toHaveFocus();
    });
    cleanup();

    // Negative: a 500 keeps the form; a later swap (the list refetched from elsewhere now holds an
    // application) is not this submit's outcome and takes no focus.
    const elsewhere = application({ status: 'submitted' });
    const kept = testQueryClient();
    renderSeeker(
      [json([]), json([elsewhere])],
      { [APPLY]: [json({ detail: 'boom' }, 500)] },
      0,
      kept,
    );
    type(await openForm(), MESSAGE);
    send();
    expect(await screen.findByRole('button', { name: he.common.retry })).toBeVisible();
    await act(() => kept.invalidateQueries({ queryKey: MY_APPLICATIONS_KEY }));
    const swapped = await (await section()).findByText(appliedText(elsewhere));
    await new Promise((r) => setTimeout(r, 50));
    expect(swapped).not.toHaveFocus();
    cleanup();

    // Negative: a misfit room and the profile gate shown on mount take no focus.
    renderSeeker([json([])], {
      [LISTING]: [room({ gender_preference: 'women', room_fit: false })],
    });
    let s = await settled();
    const mountedMisfit = s.getByText(MISFIT);
    await new Promise((r) => setTimeout(r, 50));
    expect(mountedMisfit).not.toHaveFocus();
    cleanup();

    renderSeeker([json([])], { [PROFILE]: [json({ detail: 'seeker_profile_not_found' }, 404)] });
    s = await settled();
    const mountedGate = await s.findByText(he.applications.profileRequired);
    await new Promise((r) => setTimeout(r, 50));
    expect(mountedGate).not.toHaveFocus();
  });
});
