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
import { listingDetail } from '../../search/__tests__/fixtures';
import type { MyApplicationOut } from '../api';
import { application } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

const LISTING = 'GET /listings/A';
const MINE = 'GET /me/applications';
const APPLY = 'POST /listings/A/applications';
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

const countText = (count: number) =>
  count === 0
    ? he.applications.count.zero
    : count === 1
      ? he.applications.count.one
      : i18n.t('applications.count.many', { count });
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
      () => ({ 'GET /me': [json(seeker)], [MINE]: [json([])] }),
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
});
