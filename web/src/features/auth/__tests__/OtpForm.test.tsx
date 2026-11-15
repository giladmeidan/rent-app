import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { OtpForm } from '../OtpForm';
import { readDraft, writeDraft } from '../../../app/drafts';
import { deferred, empty, json, mockApi, noa, renderAt } from './harness';

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
  it('ac3_step2_error_semantics', async () => {
    const pendingVerify = deferred();
    mockApi({
      'POST /auth/otp/request': [empty(204), json({ detail: 'rate_limited' }, 429)],
      'POST /auth/otp/verify': [
        pendingVerify.promise,
        () => Promise.reject(new TypeError('Failed to fetch')),
      ],
    });
    renderAt('/login', <OtpForm withProfile={false} />);

    const send = screen.getByRole('button', { name: he.auth.sendCode });
    fireEvent.change(screen.getByLabelText(he.auth.email.label), {
      target: { value: 'dana@example.com' },
    });
    fireEvent.click(send);
    await flush();

    const code = screen.getByLabelText(he.auth.code.label);
    const verify = screen.getByRole('button', { name: he.auth.verify });
    // Not ready (fewer than 6 digits): the native `disabled` attribute.
    fireEvent.change(code, { target: { value: '123' } });
    expect(verify).toHaveAttribute('disabled');
    fireEvent.change(code, { target: { value: '123456' } });
    expect(verify).not.toHaveAttribute('disabled');

    // Pending: disabled and busy.
    fireEvent.click(verify);
    await flush();
    expect(verify).toHaveAttribute('disabled');
    expect(verify).toHaveAttribute('aria-busy', 'true');

    // A 401: the input is invalid and described by the wrong-code alert.
    pendingVerify.resolve(json({ detail: 'invalid_code' }, 401));
    await flush();
    const wrongCode = screen.getByRole('alert');
    expect(wrongCode).toHaveTextContent(he.auth.errors.invalidCode);
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(code.getAttribute('aria-describedby')?.split(' ')).toContain(wrongCode.id);
    expect(code).toHaveAccessibleDescription(he.auth.errors.invalidCode);
    expect(verify).not.toHaveAttribute('disabled');

    // A resend answering 429: the too-many alert describes the input, which is not invalid.
    await advance(30_000);
    fireEvent.click(screen.getByRole('button', { name: he.auth.resend }));
    await flush();
    const tooMany = screen.getByRole('alert');
    expect(tooMany).toHaveTextContent(he.auth.errors.tooMany);
    expect(code).not.toHaveAttribute('aria-invalid', 'true');
    expect(code.getAttribute('aria-describedby')?.split(' ')).toContain(tooMany.id);
    expect(code).toHaveAccessibleDescription(he.auth.errors.tooMany);

    // A verify that throws: the generic alert, with the same semantics as the 429.
    fireEvent.click(verify);
    await flush();
    const failed = screen.getByRole('alert');
    expect(failed).toHaveTextContent(he.common.error);
    expect(code).not.toHaveAttribute('aria-invalid', 'true');
    expect(code.getAttribute('aria-describedby')?.split(' ')).toContain(failed.id);
    expect(code).toHaveAccessibleDescription(he.common.error);
  });

  it('ac10_suspended_account', async () => {
    // Spec 0012a: the right code for a suspended account. The alert, not a field error (the code
    // was right and is used up), an emptied field, and no navigation.
    mockApi({
      'POST /auth/otp/request': [empty(204)],
      'POST /auth/otp/verify': [json({ detail: 'account_suspended' }, 403)],
    });
    renderAt('/login', <OtpForm withProfile={false} />);
    fireEvent.change(screen.getByLabelText(he.auth.email.label), {
      target: { value: noa.email },
    });
    fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));
    await flush();
    const code = screen.getByLabelText(he.auth.code.label);
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: he.auth.verify }));
    await flush();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(he.auth.errors.suspended);
    expect(code).toHaveValue('');
    expect(code).not.toHaveAttribute('aria-invalid', 'true');
    expect(code).toHaveAccessibleDescription(he.auth.errors.suspended);
    expect(screen.getByTestId('location')).toHaveTextContent('/login');
  });

  it('ac10_other_403_is_a_failure', async () => {
    // Only `account_suspended` is the suspended alert; another 403 is the generic failure.
    mockApi({
      'POST /auth/otp/request': [empty(204)],
      'POST /auth/otp/verify': [json({ detail: 'forbidden' }, 403)],
    });
    renderAt('/login', <OtpForm withProfile={false} />);
    fireEvent.change(screen.getByLabelText(he.auth.email.label), {
      target: { value: noa.email },
    });
    fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));
    await flush();
    fireEvent.change(screen.getByLabelText(he.auth.code.label), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: he.auth.verify }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent(he.common.error);
    expect(screen.queryByText(he.auth.errors.suspended)).toBeNull();
  });

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

  it('ac1_offline_on_failed_send', async () => {
    // Step 2: a verify that fails while offline says so; online, the generic line.
    for (const [offline, text] of [
      [true, he.common.offline],
      [false, he.common.error],
    ] as const) {
      const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
      mockApi({
        'POST /auth/otp/request': [empty(204)],
        'POST /auth/otp/verify': [() => Promise.reject(new TypeError('Failed to fetch'))],
      });
      const view = renderAt('/login', <OtpForm withProfile={false} />);
      fireEvent.change(screen.getByLabelText(he.auth.email.label), {
        target: { value: 'dana@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));
      await flush();
      fireEvent.change(screen.getByLabelText(he.auth.code.label), {
        target: { value: '123456' },
      });
      onLine.mockReturnValue(!offline);
      fireEvent.click(screen.getByRole('button', { name: he.auth.verify }));
      await flush();
      expect(screen.getByRole('alert').textContent).toBe(text);
      view.unmount();
      vi.unstubAllGlobals();
      onLine.mockRestore();
    }
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

  it('ac4_resend_announced_and_focused', async () => {
    mockApi({ 'POST /auth/otp/request': [empty(204), empty(204)] });
    renderAt('/login', <OtpForm withProfile={false} />);
    /** The form's own status line (the harness's location probe is an <output>). */
    const status = () => document.querySelector('p[role="status"]');

    fireEvent.change(screen.getByLabelText(he.auth.email.label), {
      target: { value: 'dana@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));
    await flush();

    // The verify step mounts the status line empty; the countdown itself is not announced.
    expect(status()).not.toBeNull();
    expect(status()).toHaveTextContent('');
    await advance(10_000);
    expect(status()).toHaveTextContent('');

    // The cooldown ends: "you can resend".
    await advance(20_000);
    expect(status()).toHaveTextContent(he.auth.resendReady);

    // A resend 200: "code resent", focus on the code input, the resend button cooling down.
    const resend = screen.getByRole('button', { name: he.auth.resend });
    act(() => resend.focus());
    fireEvent.click(resend);
    await flush();
    expect(status()).toHaveTextContent(he.auth.codeResent);
    expect(document.activeElement).toBe(screen.getByLabelText(he.auth.code.label));
    expect(screen.getByRole('button', { name: resendIn(30) })).toBeDisabled();

    // That cooldown ends too.
    await advance(30_000);
    expect(status()).toHaveTextContent(he.auth.resendReady);
  });

  it('ac8_login_clears_other_users_drafts', async () => {
    // V's drafts are on this tab; U (noa) logs in. U's own draft stays.
    const V = '00000000-0000-0000-0000-0000000000bb';
    writeDraft('apply', 'L', V, 'from V');
    writeDraft('chat', 'C', V, 'from V');
    writeDraft('apply', 'M', noa.id, 'from U');
    mockApi({
      'POST /auth/otp/request': [empty(204)],
      'POST /auth/otp/verify': [json(noa, 200)],
    });
    renderAt('/login', <OtpForm withProfile={false} />);
    fireEvent.change(screen.getByLabelText(he.auth.email.label), {
      target: { value: noa.email },
    });
    fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));
    await flush();
    fireEvent.change(screen.getByLabelText(he.auth.code.label), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: he.auth.verify }));
    await flush();
    await flush();
    expect(readDraft('apply', 'L', V)).toBe('');
    expect(readDraft('chat', 'C', V)).toBe('');
    expect(window.sessionStorage.getItem('rent-app:draft:apply:L')).toBeNull();
    expect(window.sessionStorage.getItem('rent-app:draft:chat:C')).toBeNull();
    expect(readDraft('apply', 'M', noa.id)).toBe('from U');
  });

  it('ac16_market_signup_skips_role', async () => {
    // Spec 0010b (Q10): signup started from the market asks no owner / seeker question and stores
    // a seeker; an explicit role, or a `next` off the market, keeps the question.
    const roleGroup = () => screen.queryByRole('group', { name: he.auth.role.label });

    // Signup, `next` on the market: name and email only, sent as a seeker.
    for (const next of ['/market', '/market/mine?tab=applications']) {
      const api = mockApi({
        'POST /auth/otp/request': [empty(204)],
        'POST /auth/otp/verify': [json(noa, 201)],
      });
      const view = renderAt('/signup', <OtpForm withProfile next={next} />);
      expect(roleGroup()).toBeNull();
      expect(screen.queryByText(he.auth.hint.chooseRole)).toBeNull();
      fireEvent.change(screen.getByLabelText(he.auth.name.label), { target: { value: 'דנה' } });
      fireEvent.change(screen.getByLabelText(he.auth.email.label), {
        target: { value: 'dana@example.com' },
      });
      const send = screen.getByRole('button', { name: he.auth.sendCode });
      expect(send).not.toHaveAttribute('disabled');
      fireEvent.click(send);
      await flush();
      fireEvent.change(screen.getByLabelText(he.auth.code.label), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: he.auth.verify }));
      await flush();
      expect(api.calls('POST /auth/otp/verify')[0]?.body).toEqual({
        email: 'dana@example.com',
        code: '123456',
        profile: { display_name: 'דנה', role: 'seeker' },
      });
      view.unmount();
      vi.unstubAllGlobals();
    }

    // An explicit role wins (preset); a `next` off the market, or none, asks.
    for (const [initialRole, next, checked] of [
      ['owner', '/market', he.auth.role.owner],
      [null, '/search', null],
      [null, '/', null],
      [null, '/listings/abc', null],
    ] as const) {
      mockApi({});
      const view = renderAt(
        '/signup',
        <OtpForm withProfile initialRole={initialRole} next={next} />,
      );
      expect(roleGroup()).not.toBeNull();
      if (checked !== null) expect(screen.getByRole('radio', { name: checked })).toBeChecked();
      view.unmount();
      vi.unstubAllGlobals();
    }

    // Login with an unknown email headed to the market (or to a flat's invite, a market path):
    // step 2 asks the name only, focuses it, and sends a seeker.
    for (const next of ['/market', '/flatmates/join']) {
      const api = mockApi({
        'POST /auth/otp/request': [empty(204)],
        'POST /auth/otp/verify': [json({ detail: 'profile_required' }, 422), json(noa, 201)],
      });
      const view = renderAt('/login', <OtpForm withProfile={false} next={next} />);
      fireEvent.change(screen.getByLabelText(he.auth.email.label), {
        target: { value: 'new@example.com' },
      });
      fireEvent.click(screen.getByRole('button', { name: he.auth.sendCode }));
      await flush();
      fireEvent.change(screen.getByLabelText(he.auth.code.label), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: he.auth.verify }));
      await flush();
      expect(screen.getByText(he.auth.noAccountYet)).toBeVisible();
      expect(roleGroup()).toBeNull();
      expect(screen.getByLabelText(he.auth.name.label)).toHaveFocus();
      expect(screen.queryByText(he.auth.hint.chooseRole)).toBeNull();
      fireEvent.change(screen.getByLabelText(he.auth.name.label), { target: { value: 'דנה' } });
      fireEvent.click(screen.getByRole('button', { name: he.auth.verify }));
      await flush();
      expect(api.calls('POST /auth/otp/verify')[1]?.body).toMatchObject({
        profile: { display_name: 'דנה', role: 'seeker' },
      });
      view.unmount();
      vi.unstubAllGlobals();
    }
  });
});
