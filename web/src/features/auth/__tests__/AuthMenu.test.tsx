import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { AuthMenu } from '../AuthMenu';
import {
  deferred,
  empty,
  json,
  mockApi,
  networkError,
  noa,
  renderRoutes,
  testQueryClient,
} from './harness';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuthMenu', () => {
  it('ac1_skeleton_then_name_then_logout', async () => {
    const me = deferred();
    const logout = deferred();
    const api = mockApi({ 'GET /me': [me.promise], 'POST /auth/logout': [logout.promise] });
    renderRoutes('/', <AuthMenu />);

    expect(screen.getByTestId('skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();

    me.resolve(json(noa));
    expect(await screen.findByText(i18n.t('header.greeting', { name: 'נועה' }))).toBeVisible();
    expect(screen.queryByTestId('skeleton')).toBeNull();
    expect(screen.queryByRole('link', { name: he.header.login })).toBeNull();
    const button = screen.getByRole('button', { name: he.header.logout });

    fireEvent.click(button);
    await vi.waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(api.calls('POST /auth/logout')).toHaveLength(1);

    logout.resolve(empty(204));
    expect(await screen.findByRole('link', { name: he.header.login })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.queryByRole('button', { name: he.header.logout })).toBeNull();

    // The session cookie travels with every call.
    for (const call of [...api.calls('GET /me'), ...api.calls('POST /auth/logout')]) {
      expect(call.request.credentials).toBe('include');
    }
  });

  it('ac2_logged_out_on_401_and_on_error', async () => {
    mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)] });
    const first = renderRoutes('/', <AuthMenu />);

    expect(await screen.findByRole('link', { name: he.header.login })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.getByRole('link', { name: he.header.signup })).toHaveAttribute('href', '/signup');
    first.unmount();
    vi.unstubAllGlobals();

    // The app's own client retries queries once; useMe must override that, so the logged-out
    // header shows within 100 ms of a network failure, after a single call.
    const api = mockApi({ 'GET /me': [networkError] });
    renderRoutes('/', <AuthMenu />, testQueryClient(1));

    expect(
      await screen.findByRole('link', { name: he.header.login }, { timeout: 100 }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: he.header.signup })).toBeVisible();
    expect(api.calls('GET /me')).toHaveLength(1);
  });

  it('ac9_my_applications_link', async () => {
    // A seeker: "my applications", not "my listings".
    mockApi({ 'GET /me': [json(noa)] });
    let view = renderRoutes('/', <AuthMenu />);
    expect(await screen.findByRole('link', { name: he.header.myApplications })).toHaveAttribute(
      'href',
      '/me/applications',
    );
    expect(screen.queryByRole('link', { name: he.header.myListings })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // An owner: "my listings" only.
    mockApi({ 'GET /me': [json({ ...noa, role: 'owner' })] });
    view = renderRoutes('/', <AuthMenu />);
    expect(await screen.findByRole('link', { name: he.header.myListings })).toHaveAttribute(
      'href',
      '/me/listings',
    );
    expect(screen.queryByRole('link', { name: he.header.myApplications })).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // A visitor: neither.
    mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)] });
    renderRoutes('/', <AuthMenu />);
    expect(await screen.findByRole('link', { name: he.header.login })).toBeVisible();
    expect(screen.queryByRole('link', { name: he.header.myListings })).toBeNull();
    expect(screen.queryByRole('link', { name: he.header.myApplications })).toBeNull();
  });
});
