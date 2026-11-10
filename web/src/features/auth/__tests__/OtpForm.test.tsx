import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { OtpForm } from '../OtpForm';
import { empty, json, mockApi, renderAt } from './harness';

// Fake timers drive the cooldown, so testing-library's polling `findBy*` cannot be used here:
// `flush` runs pending timers due now and lets the mocked fetch promises settle instead.
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const resendIn = (seconds: number) => i18n.t('auth.resendIn', { seconds });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('OtpForm', () => {
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
});
