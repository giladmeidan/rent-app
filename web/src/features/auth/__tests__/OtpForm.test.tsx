import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { OtpForm } from '../OtpForm';
import { deferred, empty, json, mockApi, renderAt } from './harness';

// Fake timers drive the cooldown, so testing-library's polling `findBy*` cannot be used here:
// `flush` runs pending timers due now and lets the mocked fetch promises settle instead.
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const resendIn = (seconds: number) => i18n.t('auth.resendIn', { count: seconds });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OtpForm', () => {
  it('ac3_resend_countdown_singular', async () => {
    mockApi({ 'POST /auth/otp/request': [empty(204)] });
    renderAt('/login', <OtpForm withProfile={false} />);
    fireEvent.change(screen.getByLabelText(he.auth.email.label), {
      target: { value: 'dana@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));
    await flush();
    expect(
      screen.getByRole('button', {
        name: '\u05e9\u05dc\u05d9\u05d7\u05d4 \u05d7\u05d5\u05d6\u05e8\u05ea \u05d1\u05e2\u05d5\u05d3 30 \u05e9\u05e0\u05d9\u05d5\u05ea',
      }),
    ).toBeDisabled();
    await advance(29_000);
    expect(
      screen.getByRole('button', {
        name: '\u05e9\u05dc\u05d9\u05d7\u05d4 \u05d7\u05d5\u05d6\u05e8\u05ea \u05d1\u05e2\u05d5\u05d3 \u05e9\u05e0\u05d9\u05d9\u05d4',
      }),
    ).toBeDisabled();
  });

  it('ac8_resend_cooldown_and_rate_limit', async () => {
    const api = mockApi({
      'POST /auth/otp/request': [empty(204), empty(204), json({ detail: 'rate_limited' }, 429)],
    });
    renderAt('/login', <OtpForm withProfile={false} />);

    fireEvent.change(screen.getByLabelText(he.auth.email.label), {
      target: { value: 'dana@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));
    await flush();
    expect(screen.getByLabelText(he.auth.code.label)).toBeVisible();

    // Disabled for 30 s, counting down.
    expect(screen.getByRole('button', { name: resendIn(30) })).toBeDisabled();
    await advance(1000);
    expect(screen.getByRole('button', { name: resendIn(29) })).toBeDisabled();
    await advance(28_000);
    expect(screen.getByRole('button', { name: resendIn(1) })).toBeDisabled();
    await advance(1000);
    const resend = screen.getByRole('button', { name: he.auth.resend });
    expect(resend).toBeEnabled();

    // A successful resend sends a new code and restarts the countdown.
    fireEvent.click(resend);
    await flush();
    expect(api.calls('POST /auth/otp/request')).toHaveLength(2);
    expect(api.calls('POST /auth/otp/request')[1]?.body).toEqual({ email: 'dana@example.com' });
    expect(screen.getByRole('button', { name: resendIn(30) })).toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();

    // Once the cooldown is over again, a 429 shows the rate-limit message.
    await advance(30_000);
    fireEvent.click(screen.getByRole('button', { name: he.auth.resend }));
    await flush();
    expect(api.calls('POST /auth/otp/request')).toHaveLength(3);
    expect(screen.getByRole('alert')).toHaveTextContent(he.auth.errors.tooMany);
  });

  it('paste_with_spaces_keeps_six_digits', async () => {
    mockApi({ 'POST /auth/otp/request': [empty(204)] });
    renderAt('/login', <OtpForm withProfile={false} />);

    fireEvent.change(screen.getByLabelText(he.auth.email.label), {
      target: { value: 'dana@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));
    await flush();

    const code = screen.getByLabelText(he.auth.code.label);
    fireEvent.paste(code, { clipboardData: { getData: () => '123 456' } });
    expect(code).toHaveValue('123456');
    expect(screen.getByRole('button', { name: he.auth.verify })).toBeEnabled();
  });

  it('ac2_disabled_submit_explains_why', async () => {
    // "כדי להמשיך, צריך לבחור מה מתאים לך"
    const chooseRole =
      '\u05db\u05d3\u05d9 \u05dc\u05d4\u05de\u05e9\u05d9\u05da, \u05e6\u05e8\u05d9\u05da \u05dc\u05d1\u05d7\u05d5\u05e8 \u05de\u05d4 \u05de\u05ea\u05d0\u05d9\u05dd \u05dc\u05da';
    // "צריך להקליד את כל 6 הספרות מהאימייל"
    const enterCode =
      '\u05e6\u05e8\u05d9\u05da \u05dc\u05d4\u05e7\u05dc\u05d9\u05d3 \u05d0\u05ea \u05db\u05dc 6 \u05d4\u05e1\u05e4\u05e8\u05d5\u05ea \u05de\u05d4\u05d0\u05d9\u05de\u05d9\u05d9\u05dc';
    const describedBy = (button: HTMLElement) => button.getAttribute('aria-describedby');

    // Signup step 1 with no role: disabled, and the hint says why.
    const pending = deferred();
    mockApi({ 'POST /auth/otp/request': [pending.promise] });
    const signup = renderAt('/signup', <OtpForm withProfile />);
    const send = screen.getByRole('button', { name: he.auth.sendCode });
    expect(send).toBeDisabled();
    const hint = screen.getByText(chooseRole);
    expect(hint.id).not.toBe('');
    expect(describedBy(send)).toBe(hint.id);
    fireEvent.click(screen.getByRole('radio', { name: he.auth.role.owner }));
    expect(send).toBeEnabled();
    expect(screen.queryByText(chooseRole)).toBeNull();
    expect(describedBy(send)).toBeNull();

    // While the request is pending, no hint.
    fireEvent.change(screen.getByLabelText(he.auth.name.label), { target: { value: 'Dana' } });
    fireEvent.change(screen.getByLabelText(he.auth.email.label), {
      target: { value: 'dana@example.com' },
    });
    fireEvent.click(send);
    await flush();
    expect(send).toBeDisabled();
    expect(screen.queryByText(chooseRole)).toBeNull();
    expect(screen.queryByText(enterCode)).toBeNull();
    expect(describedBy(send)).toBeNull();
    signup.unmount();
    vi.unstubAllGlobals();

    // Login step 2 with 3 digits: the code hint.
    const verify = deferred();
    mockApi({
      'POST /auth/otp/request': [empty(204)],
      'POST /auth/otp/verify': [json({ detail: 'profile_required' }, 422), verify.promise],
    });
    renderAt('/login', <OtpForm withProfile={false} />);
    fireEvent.change(screen.getByLabelText(he.auth.email.label), {
      target: { value: 'dana@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));
    await flush();
    const code = screen.getByLabelText(he.auth.code.label);
    const submit = screen.getByRole('button', { name: he.auth.verify });
    fireEvent.change(code, { target: { value: '123' } });
    expect(submit).toBeDisabled();
    expect(describedBy(submit)).toBe(screen.getByText(enterCode).id);

    // Six digits: enabled, no hint; then the profile_required reveal without a role.
    fireEvent.change(code, { target: { value: '123456' } });
    expect(submit).toBeEnabled();
    expect(screen.queryByText(enterCode)).toBeNull();
    expect(describedBy(submit)).toBeNull();
    fireEvent.click(submit);
    await flush();
    expect(screen.getByRole('radio', { name: he.auth.role.owner })).toBeVisible();
    expect(submit).toBeDisabled();
    expect(describedBy(submit)).toBe(screen.getByText(chooseRole).id);

    // With a role, no hint; and none while the verify is pending.
    fireEvent.click(screen.getByRole('radio', { name: he.auth.role.owner }));
    expect(submit).toBeEnabled();
    expect(screen.queryByText(chooseRole)).toBeNull();
    expect(describedBy(submit)).toBeNull();
    fireEvent.change(screen.getByLabelText(he.auth.name.label), { target: { value: 'Dana' } });
    fireEvent.click(submit);
    await flush();
    expect(submit).toBeDisabled();
    expect(screen.queryByText(chooseRole)).toBeNull();
    expect(screen.queryByText(enterCode)).toBeNull();
    expect(describedBy(submit)).toBeNull();
    verify.resolve(json({ detail: 'invalid_code' }, 401));
    await flush();
  });

  it('ac4_too_many_names_the_wait', async () => {
    const limited = (retryAfter?: string) => () =>
      new Response(JSON.stringify({ detail: 'rate_limited' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          ...(retryAfter === undefined ? {} : { 'Retry-After': retryAfter }),
        },
      });
    // "יותר מדי ניסיונות. אפשר לנסות שוב "
    const lead =
      '\u05d9\u05d5\u05ea\u05e8 \u05de\u05d3\u05d9 \u05e0\u05d9\u05e1\u05d9\u05d5\u05e0\u05d5\u05ea. \u05d0\u05e4\u05e9\u05e8 \u05dc\u05e0\u05e1\u05d5\u05ea \u05e9\u05d5\u05d1 ';
    const in14 = `${lead}\u05d1\u05e2\u05d5\u05d3 14 \u05d3\u05e7\u05d5\u05ea.`; // "בעוד 14 דקות."
    const later = `${lead}\u05de\u05d0\u05d5\u05d7\u05e8 \u05d9\u05d5\u05ea\u05e8.`; // "מאוחר יותר."
    const typeEmail = () =>
      fireEvent.change(screen.getByLabelText(he.auth.email.label), {
        target: { value: 'dana@example.com' },
      });

    // Step 1, with and without the header.
    for (const [reply, text] of [
      [limited('840'), in14],
      [limited(), later],
    ] as const) {
      mockApi({ 'POST /auth/otp/request': [reply] });
      const view = renderAt('/login', <OtpForm withProfile={false} />);
      typeEmail();
      fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));
      await flush();
      expect(screen.getByRole('alert').textContent).toBe(text);
      view.unmount();
      vi.unstubAllGlobals();
    }

    // The resend, with and without the header.
    for (const [reply, text] of [
      [limited('840'), in14],
      [limited(), later],
    ] as const) {
      mockApi({ 'POST /auth/otp/request': [empty(204), reply] });
      const view = renderAt('/login', <OtpForm withProfile={false} />);
      typeEmail();
      fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));
      await flush();
      await advance(30_000);
      fireEvent.click(screen.getByRole('button', { name: he.auth.resend }));
      await flush();
      expect(screen.getByRole('alert').textContent).toBe(text);
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
});
