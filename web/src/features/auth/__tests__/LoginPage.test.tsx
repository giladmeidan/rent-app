import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { LoginPage } from '../LoginPage';
import { currentPath, empty, json, mockApi, networkError, noa, renderAt } from './harness';

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
  fireEvent.click(screen.getByRole('button', { name: he.auth.verify }));
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
});
