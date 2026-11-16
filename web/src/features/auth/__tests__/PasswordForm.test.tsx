import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import { retryAfterText } from '../../../components/retryAfter';
import he from '../../../locales/he.json';
import { LoginPage } from '../LoginPage';
import { currentPath, json, mockApi, noa, renderAt } from './harness';

const unauthenticated = json({ detail: 'unauthenticated' }, 401);
const LOGIN = 'POST /auth/password/login';

afterEach(() => {
  vi.unstubAllGlobals();
});

type Reply = Parameters<typeof mockApi>[0][string][number];

/** The login page with `/me` answering 401, switched to password mode. */
async function openPasswordMode(replies: Reply[], path = '/login') {
  const api = mockApi({ 'GET /me': [unauthenticated], [LOGIN]: replies });
  renderAt(path, <LoginPage />);
  fireEvent.click(await screen.findByRole('tab', { name: he.auth.login.mode.password }));
  return api;
}

// The password tabpanel is labelled "סיסמה" too.
const passwordInput = () => screen.getByLabelText(he.auth.password.label, { selector: 'input' });

function fill(email: string, password: string) {
  fireEvent.change(screen.getByLabelText(he.auth.email.label), { target: { value: email } });
  fireEvent.change(passwordInput(), { target: { value: password } });
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: he.auth.password.submit }));

describe('PasswordForm (spec 0016a AC13)', () => {
  it('ac13_switch_defaults_to_code', async () => {
    mockApi({ 'GET /me': [unauthenticated] });
    renderAt('/login', <LoginPage />);

    const tablist = await screen.findByRole('tablist', { name: he.auth.login.mode.label });
    const code = screen.getByRole('tab', { name: he.auth.login.mode.code });
    expect(tablist).toContainElement(code);
    expect(code).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(he.auth.login.mode.code);
    expect(screen.getByRole('button', { name: he.auth.sendCode })).toBeVisible();
    expect(screen.queryByLabelText(he.auth.password.label, { selector: 'input' })).toBeNull();
  });

  it('ac13_password_login_goes_to_next', async () => {
    const api = await openPasswordMode([json(noa)], '/login?next=%2Fme%2Flikes');
    expect(screen.queryByRole('button', { name: he.auth.sendCode })).toBeNull();
    const email = screen.getByLabelText(he.auth.email.label);
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(email).toHaveAttribute('name', 'email');
    const password = passwordInput();
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(password).toHaveAttribute('type', 'password');

    fill(' noa@example.com ', 'correct horse battery');
    submit();

    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/likes');
    });
    expect(api.calls(LOGIN).map((c) => c.body)).toEqual([
      { email: 'noa@example.com', password: 'correct horse battery' },
    ]);
  });

  it('ac13_wrong_password_clears_and_focuses_the_field', async () => {
    await openPasswordMode([json({ detail: 'invalid_credentials' }, 401)]);
    fill('noa@example.com', 'wrong password');
    submit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(he.auth.password.invalid);
    const password = passwordInput();
    expect(password).toHaveValue('');
    expect(password).toHaveFocus();
    expect(password.getAttribute('aria-describedby')?.split(' ')).toContain(alert.id);
    expect(screen.getByLabelText(he.auth.email.label)).toHaveValue('noa@example.com');
    expect(currentPath()).toBe('/login');
  });

  it('ac13_too_many_and_suspended', async () => {
    await openPasswordMode([
      json({ detail: 'rate_limited' }, 429, { 'Retry-After': '600' }),
      json({ detail: 'rate_limited' }, 429),
      json({ detail: 'account_suspended' }, 403),
    ]);
    const when = retryAfterText(i18n.t, 600);
    for (const text of [
      i18n.t('auth.errors.tooManyIn', { when }),
      he.auth.errors.tooMany,
      he.auth.errors.suspended,
    ]) {
      fill('noa@example.com', 'some password');
      submit();
      await vi.waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent(text);
      });
    }
  });

  it('ac13_empty_fields_send_nothing', async () => {
    const api = await openPasswordMode([json(noa)]);
    submit();

    expect(screen.getByLabelText(he.auth.email.label)).toHaveAccessibleDescription(
      he.listings.errors.required,
    );
    expect(screen.getByLabelText(he.auth.email.label)).toHaveFocus();
    fill('noa@example.com', '');
    submit();
    expect(passwordInput()).toHaveAccessibleDescription(he.listings.errors.required);
    expect(api.calls(LOGIN)).toHaveLength(0);
  });

  it('ac13_forgot_switches_to_code_with_the_email', async () => {
    await openPasswordMode([json(noa)]);
    fill('noa@example.com', '');

    fireEvent.click(screen.getByRole('button', { name: he.auth.password.forgotAction }));

    expect(screen.getByRole('tab', { name: he.auth.login.mode.code })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByLabelText(he.auth.email.label)).toHaveValue('noa@example.com');
    expect(screen.getByRole('button', { name: he.auth.sendCode })).toBeVisible();
  });
});
