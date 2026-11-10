import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../../locales/he.json';
import { SignupPage } from '../SignupPage';
import { currentPath, deferred, empty, json, mockApi, noa, renderAt } from './harness';

const unauthenticated = json({ detail: 'unauthenticated' }, 401);

afterEach(() => {
  vi.unstubAllGlobals();
});

const nameInput = () => screen.getByLabelText(he.auth.name.label);
const emailInput = () => screen.getByLabelText(he.auth.email.label);
const sendCode = () => screen.getByRole('button', { name: he.auth.sendCode });

describe('SignupPage', () => {
  it('ac3_signup_sends_profile_and_navigates_on_200_or_201', async () => {
    for (const status of [201, 200]) {
      const request = deferred();
      const api = mockApi({
        'GET /me': [unauthenticated],
        'POST /auth/otp/request': [request.promise],
        'POST /auth/otp/verify': [json(noa, status)],
      });
      const view = renderAt('/signup?role=seeker', <SignupPage />);

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(he.auth.signup.title);
      expect(screen.getByRole('radio', { name: he.auth.role.seeker })).toBeChecked();
      expect(screen.getByRole('radio', { name: he.auth.role.owner })).not.toBeChecked();

      fireEvent.change(nameInput(), { target: { value: '  נועה ' } });
      fireEvent.change(emailInput(), { target: { value: 'noa@example.com' } });
      fireEvent.click(sendCode());

      await vi.waitFor(() => {
        expect(api.calls('POST /auth/otp/request').map((c) => c.body)).toEqual([
          { email: 'noa@example.com' },
        ]);
      });
      expect(sendCode()).toBeDisabled();
      expect(sendCode()).toHaveAttribute('aria-busy', 'true');

      request.resolve(empty(204));
      const code = await screen.findByLabelText(he.auth.code.label);
      expect(code).toHaveFocus();
      expect(screen.getByText(/noa@example\.com/)).toHaveTextContent(
        he.auth.code.sentTo.replace(' {{email}}', ''),
      );

      fireEvent.change(code, { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: he.auth.verify }));

      await vi.waitFor(() => {
        expect(currentPath()).toBe('/');
      });
      expect(screen.getByText('home')).toBeVisible();
      expect(api.calls('POST /auth/otp/verify').map((c) => c.body)).toEqual([
        {
          email: 'noa@example.com',
          code: '123456',
          profile: { display_name: 'נועה', role: 'seeker' },
        },
      ]);
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ac4_client_and_server_validation', async () => {
    const api = mockApi({
      'GET /me': [unauthenticated],
      'POST /auth/otp/request': [
        json({ detail: [{ loc: ['body', 'email'], msg: 'bad', type: 'value_error' }] }, 422),
      ],
    });
    renderAt('/signup', <SignupPage />);

    // No ?role: nothing preselected and the submit waits for a choice.
    expect(screen.getByRole('radio', { name: he.auth.role.owner })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: he.auth.role.seeker })).not.toBeChecked();
    expect(sendCode()).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: he.auth.role.owner }));
    expect(screen.getByRole('radio', { name: he.auth.role.owner })).toBeChecked();
    expect(sendCode()).toBeEnabled();

    // A 1-character name (after trimming) is refused before any request.
    fireEvent.change(nameInput(), { target: { value: ' א ' } });
    fireEvent.change(emailInput(), { target: { value: 'noa@example.com' } });
    fireEvent.click(sendCode());
    expect(await screen.findByRole('alert')).toHaveTextContent(he.auth.errors.nameLength);
    expect(api.calls('POST /auth/otp/request')).toHaveLength(0);

    // A malformed email is refused before any request.
    fireEvent.change(nameInput(), { target: { value: 'נועה' } });
    fireEvent.change(emailInput(), { target: { value: 'a@b' } });
    fireEvent.click(sendCode());
    expect(await screen.findByRole('alert')).toHaveTextContent(he.auth.errors.invalidEmail);
    expect(api.calls('POST /auth/otp/request')).toHaveLength(0);

    // The API's 422 maps to the same message.
    fireEvent.change(emailInput(), { target: { value: 'noa@example.com' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(sendCode());
    expect(await screen.findByRole('alert')).toHaveTextContent(he.auth.errors.invalidEmail);
    expect(api.calls('POST /auth/otp/request')).toHaveLength(1);
    expect(screen.queryByLabelText(he.auth.code.label)).toBeNull();
  });
});
