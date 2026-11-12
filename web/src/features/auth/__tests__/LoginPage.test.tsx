import { cleanup, fireEvent, screen } from '@testing-library/react';
import { Route, Routes, useNavigationType } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { application } from '../../applications/__tests__/fixtures';
import { MyApplicationsPage } from '../../applications/MyApplicationsPage';
import { LoginPage } from '../LoginPage';
import { OtpForm } from '../OtpForm';
import {
  currentPath,
  empty,
  json,
  mockApi,
  deferred,
  networkError,
  noa,
  renderAt,
  renderRoutes,
  testQueryClient,
} from './harness';

const unauthenticated = json({ detail: 'unauthenticated' }, 401);

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Fills the email, submits step 1 and waits for the code input (step 2). */
async function reachStep2() {
  fireEvent.change(screen.getByLabelText(he.auth.email.label), {
    target: { value: 'dana@example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));
  return screen.findByLabelText(he.auth.code.label);
}

function submitCode(code: HTMLElement, value: string) {
  fireEvent.change(code, { target: { value } });
  const verify = screen.getByRole('button', { name: he.auth.verify });
  verify.focus();
  fireEvent.click(verify);
}

describe('LoginPage', () => {
  it('ac5_network_error_retry_and_invalid_code', async () => {
    const api = mockApi({
      'GET /me': [unauthenticated],
      'POST /auth/otp/request': [networkError, empty(204)],
      'POST /auth/otp/verify': [json({ detail: 'invalid_code' }, 401)],
    });
    renderAt('/login', <LoginPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(he.auth.login.title);
    // Login asks for the email only.
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByLabelText(he.auth.name.label)).toBeNull();

    fireEvent.change(screen.getByLabelText(he.auth.email.label), {
      target: { value: 'dana@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(he.common.error);
    fireEvent.click(screen.getByRole('button', { name: he.common.retry }));

    const code = await screen.findByLabelText(he.auth.code.label);
    expect(api.calls('POST /auth/otp/request').map((c) => c.body)).toEqual([
      { email: 'dana@example.com' },
      { email: 'dana@example.com' },
    ]);
    expect(code).toHaveFocus();

    submitCode(code, '000000');
    expect(await screen.findByRole('alert')).toHaveTextContent(he.auth.errors.invalidCode);
    expect(screen.getByLabelText(he.auth.code.label)).toHaveFocus();
    expect(currentPath()).toBe('/login');
  });

  it('ac6_profile_required_reveals_profile_fields', async () => {
    const api = mockApi({
      'GET /me': [unauthenticated],
      'POST /auth/otp/request': [empty(204)],
      'POST /auth/otp/verify': [
        json({ detail: 'profile_required' }, 422),
        json({ ...noa, email: 'dana@example.com', display_name: 'דנה', role: 'owner' }, 201),
      ],
    });
    const view = renderAt('/login', <LoginPage />);

    const code = await reachStep2();
    submitCode(code, '123456');

    const owner = await screen.findByRole('radio', { name: he.auth.role.owner });
    expect(screen.getByRole('radio', { name: he.auth.role.seeker })).toBeVisible();
    expect(screen.getByLabelText(he.auth.name.label)).toBeVisible();
    expect(screen.getByText(he.auth.noAccountYet)).toBeVisible();
    expect(owner).toHaveFocus();
    // No role chosen yet: nothing to submit.
    expect(screen.getByRole('button', { name: he.auth.verify })).toBeDisabled();

    fireEvent.click(owner);
    fireEvent.change(screen.getByLabelText(he.auth.name.label), { target: { value: 'דנה' } });
    fireEvent.click(screen.getByRole('button', { name: he.auth.verify }));

    await vi.waitFor(() => {
      expect(currentPath()).toBe('/');
    });
    expect(api.calls('POST /auth/otp/verify').map((c) => c.body)).toEqual([
      { email: 'dana@example.com', code: '123456' },
      {
        email: 'dana@example.com',
        code: '123456',
        profile: { display_name: 'דנה', role: 'owner' },
      },
    ]);
    // Still a single email: the profile goes with the same code.
    expect(api.calls('POST /auth/otp/request')).toHaveLength(1);
    view.unmount();
    vi.unstubAllGlobals();

    // A validation 422 (list detail) is a plain error, not a request for the profile.
    mockApi({
      'GET /me': [unauthenticated],
      'POST /auth/otp/request': [empty(204)],
      'POST /auth/otp/verify': [
        json({ detail: [{ loc: ['body', 'code'], msg: 'bad', type: 'string_pattern' }] }, 422),
      ],
    });
    renderAt('/login', <LoginPage />);
    submitCode(await reachStep2(), '123456');

    expect(await screen.findByRole('alert')).toHaveTextContent(he.common.error);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByText(he.auth.noAccountYet)).toBeNull();
  });

  it('ac10_login_returns_to_next', async () => {
    const routes = (
      <Routes>
        <Route path="/" element={<p>home</p>} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/listings/:id" element={<p>listing</p>} />
      </Routes>
    );

    // A safe `next`: the verified person lands there; an unsafe one falls back to `/`.
    for (const [next, target] of [
      ['%2Flistings%2FA', '/listings/A'],
      ['%2F%2Fevil.example', '/'],
    ] as const) {
      mockApi({
        'GET /me': [json({ detail: 'unauthenticated' }, 401)],
        'POST /auth/otp/request': [empty(204)],
        'POST /auth/otp/verify': [json(noa, 200)],
      });
      const view = renderRoutes(`/login?next=${next}`, routes);
      submitCode(await reachStep2(), '123456');
      await vi.waitFor(() => {
        expect(currentPath()).toBe(target);
      });
      view.unmount();
      vi.unstubAllGlobals();
    }

    // Already logged in: straight to `next`.
    mockApi({ 'GET /me': [json(noa)] });
    renderRoutes('/login?next=%2Flistings%2FA', routes);
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/listings/A');
    });
    expect(screen.getByText('listing')).toBeVisible();
    cleanup();

    // Defence in depth: OtpForm itself re-checks `next` before navigating.
    mockApi({
      'POST /auth/otp/request': [empty(204)],
      'POST /auth/otp/verify': [json(noa, 200)],
    });
    renderAt('/login', <OtpForm withProfile={false} next="//evil.example" />);
    submitCode(await reachStep2(), '123456');
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/');
    });
  });

  it('ac10_login_clears_the_previous_session', async () => {
    // How the page was reached: a `replace` keeps /login out of the history (Back skips it).
    function Landing() {
      return (
        <>
          <output data-testid="navigation">{useNavigationType()}</output>
          <MyApplicationsPage />
        </>
      );
    }
    const routes = (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/me/applications" element={<Landing />} />
      </Routes>
    );
    // The previous person's list is still cached in this tab (their session ended without a 401
    // from a seeker call, e.g. a logout in another tab).
    const previousMessage = 'the previous seeker wrote this';
    const previous = application({ message: previousMessage });
    const client = testQueryClient();
    client.setQueryData(['me', 'applications'], [previous]);
    const list = deferred();
    mockApi({
      'GET /me': [unauthenticated],
      'POST /auth/otp/request': [empty(204)],
      'POST /auth/otp/verify': [json(noa, 200)],
      'GET /me/applications': [list.promise],
    });
    renderRoutes('/login?next=%2Fme%2Fapplications', routes, client);
    submitCode(await reachStep2(), '123456');
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/applications');
    });
    expect(screen.getByTestId('navigation')).toHaveTextContent('REPLACE');
    expect(screen.queryByText(previousMessage)).toBeNull();
    expect(screen.queryByRole('article')).toBeNull();
    expect(
      screen.getByText(he.common.loading).closest<HTMLElement>('[aria-busy="true"]'),
    ).toHaveAttribute('aria-busy', 'true');
    expect(client.getQueryData(['me'])).toEqual(noa);
  });
});
