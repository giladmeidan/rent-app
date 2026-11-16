import { fireEvent, screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UserOut } from '../../../api/client';
import he from '../../../locales/he.json';
import {
  currentPath,
  empty,
  json,
  mockApi,
  noa,
  renderRoutes,
  testQueryClient,
} from '../../auth/__tests__/harness';
import { ME_KEY } from '../../auth/useMe';
import { PasswordSection } from '../PasswordSection';

const PUT = 'PUT /me/password';
const LOGOUT = 'POST /auth/logout';

afterEach(() => {
  vi.unstubAllGlobals();
});

type Reply = Parameters<typeof mockApi>[0][string][number];

function renderSection(me: UserOut, routes: Record<string, Reply[]> = {}) {
  const api = mockApi({ 'GET /me': [json(me)], ...routes });
  const client = testQueryClient();
  renderRoutes(
    '/me/profile',
    <Routes>
      <Route path="/me/profile" element={<PasswordSection />} />
      <Route path="/login" element={<p>login</p>} />
    </Routes>,
    client,
  );
  return { api, client };
}

async function openWith(button: string, value: string) {
  fireEvent.click(await screen.findByRole('button', { name: button }));
  const input = screen.getByLabelText(he.profile.password.newLabel);
  expect(input).toHaveFocus();
  expect(input).toHaveAttribute('autocomplete', 'new-password');
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: he.profile.password.save }));
  return input;
}

describe('PasswordSection (spec 0016a AC15)', () => {
  it('ac15_set_then_change_by_has_password', async () => {
    const { api, client } = renderSection(noa, { [PUT]: [empty(204)] });
    expect(await screen.findByText(he.profile.password.none)).toBeVisible();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(he.profile.password.title);

    // 1-9 characters: the inline error, no request.
    const input = await openWith(he.profile.password.set, 'short');
    expect(input).toHaveAccessibleDescription(
      `${he.auth.password.hint} ${he.auth.password.tooShort}`,
    );
    expect(api.calls(PUT)).toHaveLength(0);

    fireEvent.change(input, { target: { value: 'long enough password' } });
    fireEvent.click(screen.getByRole('button', { name: he.profile.password.save }));

    expect(await screen.findByText(he.profile.password.saved)).toHaveAttribute('role', 'status');
    expect(api.calls(PUT).map((c) => c.body)).toEqual([{ password: 'long enough password' }]);
    expect(client.getQueryData<UserOut>(ME_KEY)?.has_password).toBe(true);
    expect(screen.getByText(he.profile.password.has)).toBeVisible();
    expect(screen.queryByLabelText(he.profile.password.newLabel)).toBeNull();
    expect(screen.getByRole('button', { name: he.profile.password.change })).toHaveFocus();
  });

  it('ac15_reauth_required_leads_to_login', async () => {
    const { api } = renderSection(
      { ...noa, has_password: true },
      { [PUT]: [json({ detail: 'reauth_required' }, 403)], [LOGOUT]: [empty(204)] },
    );
    await openWith(he.profile.password.change, 'long enough password');

    expect(await screen.findByText(he.profile.password.reauth)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: he.profile.password.reauthAction }));

    await vi.waitFor(() => {
      expect(currentPath()).toBe('/login?next=%2Fme%2Fprofile');
    });
    expect(api.calls(LOGOUT)).toHaveLength(1);
  });

  it('ac15_rate_limited_and_failure', async () => {
    renderSection(noa, {
      [PUT]: [json({ detail: 'rate_limited' }, 429), json({ detail: 'boom' }, 500)],
    });
    await openWith(he.profile.password.set, 'long enough password');
    expect(await screen.findByRole('alert')).toHaveTextContent(he.auth.errors.tooMany);

    fireEvent.click(screen.getByRole('button', { name: he.profile.password.save }));
    await vi.waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(he.common.error);
    });
  });
});
