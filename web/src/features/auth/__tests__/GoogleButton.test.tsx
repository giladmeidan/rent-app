import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONTACT_EMAIL_INLINE } from '../../../app/contact';
import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { GIS_SRC, nameFromCredential } from '../GoogleButton';
import { LoginPage } from '../LoginPage';
import { SignupPage } from '../SignupPage';
import { currentPath, deferred, json, mockApi, networkError, noa, renderRoutes } from './harness';
import { capture } from '../../../app/analytics';

// No `importOriginal`: analytics → routePattern → routes → this page would load the real module.
vi.mock('../../../app/analytics', () => ({ capture: vi.fn() }));

const unauthenticated = json({ detail: 'unauthenticated' }, 401);
const CLIENT_ID = 'test.apps.googleusercontent.com';

type Callback = (response: { credential: string }) => void;

/** A stubbed `window.google.accounts.id`: records `initialize` and `renderButton`. */
function stubGis() {
  let callback: Callback | null = null;
  const initialize = vi.fn((config: { callback: Callback }) => {
    callback = config.callback;
  });
  const renderButton = vi.fn();
  vi.stubGlobal('google', { accounts: { id: { initialize, renderButton } } });
  return {
    initialize,
    renderButton,
    /** Google hands the page a credential. */
    press: (credential: string) => act(() => callback?.({ credential })),
  };
}

/** A JWT-shaped string whose payload carries `name` (unsigned: only the pre-fill reads it). */
function jwtWithName(name: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ sub: 'g1', name }));
  const payload = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `eyJhbGciOiJSUzI1NiJ9.${payload}.c2ln`;
}

function renderPage(path: string) {
  return renderRoutes(
    path,
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="*" element={<p>elsewhere</p>} />
    </Routes>,
  );
}

const googleCalls = (api: ReturnType<typeof mockApi>) =>
  api.calls('POST /auth/google').map((c) => c.body);

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.head.querySelectorAll(`script[src="${GIS_SRC}"]`).forEach((s) => s.remove());
});

describe('GoogleButton', () => {
  it('ac12_no_button_without_client_id', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    const gis = stubGis();
    mockApi({ 'GET /me': [unauthenticated] });
    renderPage('/login');

    await screen.findByLabelText(he.auth.email.label);
    expect(screen.queryByTestId('google-button')).toBeNull();
    expect(screen.queryByText(he.auth.google.or)).toBeNull();
    expect(document.querySelector(`script[src="${GIS_SRC}"]`)).toBeNull();
    expect(gis.initialize).not.toHaveBeenCalled();
  });

  it('ac12_renders_button_and_logs_in', async () => {
    const gis = stubGis();
    const api = mockApi({ 'GET /me': [unauthenticated], 'POST /auth/google': [json(noa)] });
    renderPage('/login?next=%2Fme%2Flikes');

    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());
    expect(gis.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: CLIENT_ID, context: 'signin' }),
    );
    expect(gis.renderButton).toHaveBeenCalledWith(
      screen.getByTestId('google-button'),
      expect.objectContaining({ type: 'standard', text: 'continue_with', locale: 'he' }),
    );
    expect(screen.getByText(he.auth.google.or)).toBeVisible();
    expect(document.querySelector(`script[src="${GIS_SRC}"]`)).toBeNull(); // already loaded

    gis.press('fake:g1:noa@example.com');
    await waitFor(() => expect(currentPath()).toBe('/me/likes'));
    expect(googleCalls(api)).toEqual([{ credential: 'fake:g1:noa@example.com' }]);
  });

  it('ac12_pending_ignores_a_second_callback', async () => {
    const gis = stubGis();
    const reply = deferred();
    const api = mockApi({ 'GET /me': [unauthenticated], 'POST /auth/google': [reply.promise] });
    renderPage('/login');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());

    gis.press('first');
    gis.press('second');
    expect(await screen.findByText(he.auth.google.pending)).toHaveAttribute('role', 'status');
    reply.resolve(json(noa));
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(googleCalls(api)).toEqual([{ credential: 'first' }]);
  });

  it('ac12_profile_panel_prefills_and_submits', async () => {
    const gis = stubGis();
    const credential = jwtWithName('  נועה כהן ');
    const api = mockApi({
      'GET /me': [unauthenticated],
      'POST /auth/google': [
        json({ detail: 'profile_required' }, 422),
        json({ ...noa, role: 'owner' }, 201),
      ],
    });
    renderPage('/signup?role=owner');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());
    expect(gis.initialize).toHaveBeenCalledWith(expect.objectContaining({ context: 'signup' }));

    gis.press(credential);
    const title = await screen.findByRole('heading', { level: 2, name: he.auth.google.step.title });
    expect(title).toBeVisible();
    // The panel replaces the button, divider and form.
    expect(screen.queryByTestId('google-button')).toBeNull();
    expect(screen.queryByRole('button', { name: he.auth.sendCode })).toBeNull();
    expect(screen.getByLabelText(he.auth.name.label)).toHaveValue('נועה כהן');
    const owner = screen.getByRole('radio', { name: he.auth.role.owner });
    expect(owner).toBeChecked(); // preset from ?role=
    expect(owner).toHaveFocus();
    expect(screen.getByRole('link', { name: /תנאי השימוש/ })).toHaveAttribute('target', '_blank');

    fireEvent.click(screen.getByRole('button', { name: he.auth.google.step.submit }));
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(googleCalls(api)).toEqual([
      { credential },
      { credential, profile: { display_name: 'נועה כהן', role: 'owner' } },
    ]);
  });

  it('ac12_panel_role_question_follows_askRoleFor', async () => {
    const gis = stubGis();
    const api = mockApi({
      'GET /me': [unauthenticated],
      'POST /auth/google': [json({ detail: 'profile_required' }, 422)],
    });
    renderPage('/login?next=%2Fmarket');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());

    gis.press('fake:g1:noa@example.com');
    const nameInput = await screen.findByLabelText(he.auth.name.label);
    // Headed for the market: no role question, stored as seeker; no JWT, so no pre-fill.
    expect(screen.queryByRole('radio')).toBeNull();
    expect(nameInput).toHaveValue('');
    expect(nameInput).toHaveFocus();

    // A bad name: the field's error and no request.
    fireEvent.change(nameInput, { target: { value: 'א' } });
    fireEvent.click(screen.getByRole('button', { name: he.auth.google.step.submit }));
    expect(screen.getByText(he.auth.errors.nameLength)).toBeVisible();
    expect(googleCalls(api)).toHaveLength(1);
  });

  it('ac12_panel_without_role_waits_for_one', async () => {
    const gis = stubGis();
    mockApi({
      'GET /me': [unauthenticated],
      'POST /auth/google': [json({ detail: 'profile_required' }, 422)],
    });
    renderPage('/signup');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());

    gis.press('fake:g1:noa@example.com');
    const submit = await screen.findByRole('button', { name: he.auth.google.step.submit });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAccessibleDescription(he.auth.hint.chooseRole);
    fireEvent.click(screen.getByRole('radio', { name: he.auth.role.seeker }));
    expect(submit).not.toBeDisabled();
  });

  it('ac12_cancel_closes_the_panel', async () => {
    const gis = stubGis();
    const api = mockApi({
      'GET /me': [unauthenticated],
      'POST /auth/google': [json({ detail: 'profile_required' }, 422)],
    });
    renderPage('/login');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalledTimes(1));

    gis.press('fake:g1:noa@example.com');
    fireEvent.click(await screen.findByRole('button', { name: he.auth.google.step.cancel }));

    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.getByLabelText(he.auth.email.label)).toBeVisible();
    // Focus is back in the card, and Google's button is drawn again.
    expect(screen.getByTestId('auth-card')).toContainElement(document.activeElement as HTMLElement);
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalledTimes(2));
    expect(googleCalls(api)).toHaveLength(1);
  });

  it('ac12_expired_credential_in_the_panel_returns_to_the_button', async () => {
    const gis = stubGis();
    mockApi({
      'GET /me': [unauthenticated],
      'POST /auth/google': [
        json({ detail: 'profile_required' }, 422),
        json({ detail: 'invalid_google_token' }, 401),
      ],
    });
    renderPage('/signup?role=seeker');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());

    gis.press(jwtWithName('דנה'));
    fireEvent.click(await screen.findByRole('button', { name: he.auth.google.step.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(he.auth.google.errors.invalid);
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.getByTestId('google-button')).toBeInTheDocument();
  });

  it('ac12_panel_error_keeps_the_panel_open', async () => {
    const gis = stubGis();
    mockApi({
      'GET /me': [unauthenticated],
      'POST /auth/google': [
        json({ detail: 'profile_required' }, 422),
        json({ detail: 'rate_limited' }, 429, { 'Retry-After': '600' }),
      ],
    });
    renderPage('/signup?role=seeker');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());

    gis.press(jwtWithName('דנה'));
    fireEvent.click(await screen.findByRole('button', { name: he.auth.google.step.submit }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('auth.errors.tooManyIn', { when: i18n.t('common.inMinutes', { count: 10 }) }),
    );
    expect(
      screen.getByRole('heading', { level: 2, name: he.auth.google.step.title }),
    ).toBeVisible();
    expect(screen.getByLabelText(he.auth.name.label)).toHaveValue('דנה');
  });

  it('ac12_cancel_disabled_while_the_panel_submits', async () => {
    const gis = stubGis();
    const reply = deferred();
    mockApi({
      'GET /me': [unauthenticated],
      'POST /auth/google': [json({ detail: 'profile_required' }, 422), reply.promise],
    });
    renderPage('/signup?role=seeker');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());

    gis.press(jwtWithName('דנה'));
    const cancel = await screen.findByRole('button', { name: he.auth.google.step.cancel });
    expect(cancel).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: he.auth.google.step.submit }));
    await waitFor(() => expect(cancel).toBeDisabled());

    reply.resolve(json(noa, 201));
    await waitFor(() => expect(currentPath()).toBe('/'));
  });

  it.each([
    ['401', () => json({ detail: 'invalid_google_token' }, 401), he.auth.google.errors.invalid],
    ['409', () => json({ detail: 'google_account_conflict' }, 409), he.auth.google.errors.conflict],
    ['403 suspended', () => json({ detail: 'account_suspended' }, 403), he.auth.errors.suspended],
    [
      '403 blocked',
      () => json({ detail: 'signup_blocked' }, 403),
      i18n.t('auth.errors.signupBlocked', { email: CONTACT_EMAIL_INLINE }),
    ],
    [
      '429',
      () => json({ detail: 'rate_limited' }, 429, { 'Retry-After': '600' }),
      i18n.t('auth.errors.tooManyIn', { when: i18n.t('common.inMinutes', { count: 10 }) }),
    ],
    ['429 without wait', () => json({ detail: 'rate_limited' }, 429), he.auth.errors.tooMany],
    ['503', () => json({ detail: 'google_unavailable' }, 503), he.common.error],
    ['network', networkError, he.common.error],
  ])('ac12_error_%s', async (_label, reply, text) => {
    const gis = stubGis();
    mockApi({ 'GET /me': [unauthenticated], 'POST /auth/google': [reply] });
    renderPage('/login');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());

    gis.press('fake:g1:noa@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    expect(currentPath()).toBe('/login');
  });

  it('ac12_script_error_collapses_the_area', async () => {
    mockApi({ 'GET /me': [unauthenticated] });
    renderPage('/login');

    await waitFor(() => expect(document.querySelector(`script[src="${GIS_SRC}"]`)).not.toBeNull());
    const script = document.querySelector(`script[src="${GIS_SRC}"]`) as HTMLScriptElement;
    expect(script.async).toBe(true);
    // Loading: the placeholder and the divider are shown.
    expect(screen.getByTestId('google-button')).toBeInTheDocument();
    expect(screen.getByText(he.auth.google.or)).toBeVisible();
    // Typed before the script fails: the form is not remounted, so it stays.
    fireEvent.change(await screen.findByLabelText(he.auth.email.label), {
      target: { value: 'dana@example.com' },
    });

    act(() => {
      script.dispatchEvent(new Event('error'));
    });
    await waitFor(() => expect(screen.queryByTestId('google-button')).toBeNull());
    expect(screen.queryByText(he.auth.google.or)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText(he.auth.email.label)).toHaveValue('dana@example.com');
  });

  it('ac12_name_from_credential', () => {
    expect(nameFromCredential(jwtWithName('נועה'))).toBe('נועה');
    expect(nameFromCredential(jwtWithName('א'.repeat(50)))).toBe('א'.repeat(40));
    expect(nameFromCredential('fake:g1:noa@example.com')).toBe('');
    expect(nameFromCredential('a.!!!.c')).toBe('');
    expect(nameFromCredential(`a.${btoa('{"sub":"1"}')}.c`)).toBe('');
  });

  it('signup_started_only_in_signup_context', async () => {
    // Spec 0019b: Google's callback on /signup sends `signup_started`; on /login nothing.
    vi.mocked(capture).mockClear();
    let gis = stubGis();
    mockApi({ 'GET /me': [unauthenticated], 'POST /auth/google': [json(noa)] });
    const login = renderPage('/login');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());
    gis.press('fake:g1:noa@example.com');
    await waitFor(() => expect(currentPath()).toBe('/'));
    expect(capture).not.toHaveBeenCalled();
    login.unmount();

    gis = stubGis();
    mockApi({ 'GET /me': [unauthenticated], 'POST /auth/google': [json(noa, 201)] });
    renderPage('/signup');
    await waitFor(() => expect(gis.renderButton).toHaveBeenCalled());
    gis.press('fake:g1:noa@example.com');
    expect(capture).toHaveBeenCalledOnce();
    expect(capture).toHaveBeenCalledWith('signup_started', { method: 'google' });
  });
});
