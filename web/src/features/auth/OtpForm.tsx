import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { api, type Role, type UserOut } from '../../api/client';
import type { components } from '../../api/schema';
import { ErrorState } from '../../components/ErrorState';
import { RoleChoice } from './RoleChoice';
import { ME_KEY } from './useMe';

type OtpVerifyIn = components['schemas']['OtpVerifyIn'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[0-9]{6}$/;
const RESEND_COOLDOWN_S = 30;

/** 2–40 code points after trimming, as Postgres `char_length` counts them. */
const nameIsValid = (name: string) => {
  const length = [...name.trim()].length;
  return length >= 2 && length <= 40;
};

type RequestResult = 'ok' | 'invalidEmail' | 'tooMany' | 'failed';

async function requestCode(email: string): Promise<RequestResult> {
  try {
    const { response } = await api.POST('/auth/otp/request', { body: { email } });
    if (response.status === 204) return 'ok';
    if (response.status === 422) return 'invalidEmail';
    if (response.status === 429) return 'tooMany';
    return 'failed';
  } catch {
    return 'failed'; // network error
  }
}

type VerifyResult =
  | { kind: 'ok'; user: UserOut }
  | { kind: 'invalidCode' }
  | { kind: 'profileRequired' }
  | { kind: 'failed' };

/** True only for a body that is exactly `{"detail": "profile_required"}`. */
function isProfileRequired(body: unknown): body is { detail: 'profile_required' } {
  return (
    typeof body === 'object' &&
    body !== null &&
    Object.keys(body).length === 1 &&
    'detail' in body &&
    body.detail === 'profile_required'
  );
}

async function verifyCode(body: OtpVerifyIn): Promise<VerifyResult> {
  try {
    const { data, error, response } = await api.POST('/auth/otp/verify', { body });
    if (data !== undefined && (response.status === 200 || response.status === 201)) {
      return { kind: 'ok', user: data };
    }
    if (response.status === 401) return { kind: 'invalidCode' };
    if (response.status === 422 && isProfileRequired(error)) return { kind: 'profileRequired' };
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' }; // network error
  }
}

const label = 'text-sm font-bold';
const input =
  'min-h-[48px] w-full rounded-xl border-[1.5px] border-[#D6D3D1] bg-white px-3 text-base font-semibold text-ink focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-tint aria-[invalid=true]:border-[#B91C1C]';
const fieldError = 'text-sm font-semibold text-[#B91C1C]';
const primary =
  'min-h-[52px] w-full rounded-[14px] bg-accent text-base font-bold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';
const secondary =
  'min-h-[44px] rounded-full px-3 text-sm font-semibold text-accent-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-muted';

type Props = {
  /** Signup: step 1 collects role and name too. Login: email only; the profile is asked for only
   * when verify answers `profile_required`. */
  withProfile: boolean;
  initialRole?: Role | null;
  /** Where a successful verify goes: a path already checked by `safeNext`. */
  next?: string;
};

type Step1Error = 'tooMany' | 'failed' | null;
type Step2Error = 'invalidCode' | 'tooMany' | 'failed' | null;

/**
 * Two-step email-code form shared by /signup and /login. The email and code live in this
 * component's state only (never storage or the URL).
 */
export function OtpForm({ withProfile, initialRole = null, next = '/' }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const id = useId();

  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [role, setRole] = useState<Role | null>(initialRole);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // Login only: the email has no account yet, so step 2 also asks for role and name.
  const [profileNeeded, setProfileNeeded] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [step1Error, setStep1Error] = useState<Step1Error>(null);
  const [step2Error, setStep2Error] = useState<Step2Error>(null);
  const [resendDeadline, setResendDeadline] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const firstRadioRef = useRef<HTMLInputElement>(null);
  const backToEmailRef = useRef(false);

  const request = useMutation({ mutationFn: requestCode, gcTime: 0 });
  const resend = useMutation({ mutationFn: requestCode, gcTime: 0 });
  const verify = useMutation({ mutationFn: verifyCode, gcTime: 0 });

  const askProfile = withProfile || profileNeeded;

  function startCooldown() {
    setResendDeadline(Date.now() + RESEND_COOLDOWN_S * 1000);
    setSecondsLeft(RESEND_COOLDOWN_S);
  }

  // Count down from the deadline, so a throttled background tab still ends on time.
  useEffect(() => {
    if (resendDeadline === null) return;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((resendDeadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendDeadline]);

  // Step 2 starts in the code input; "change email" returns to the email input.
  useEffect(() => {
    if (step === 'verify') {
      codeRef.current?.focus();
    } else if (backToEmailRef.current) {
      backToEmailRef.current = false;
      emailRef.current?.focus();
    }
  }, [step]);

  useEffect(() => {
    if (profileNeeded) firstRadioRef.current?.focus();
  }, [profileNeeded]);

  function sendRequest() {
    const nameOk = !withProfile || nameIsValid(name);
    const emailOk = EMAIL_RE.test(email.trim());
    setNameError(!nameOk);
    setEmailError(!emailOk);
    setStep1Error(null);
    if (!nameOk) {
      nameRef.current?.focus();
      return;
    }
    if (!emailOk) {
      emailRef.current?.focus();
      return;
    }
    request.mutate(email.trim(), {
      onSuccess: (result) => {
        if (result === 'ok') {
          setCode('');
          setStep2Error(null);
          startCooldown();
          setStep('verify');
        } else if (result === 'invalidEmail') {
          setEmailError(true);
          emailRef.current?.focus();
        } else {
          setStep1Error(result);
        }
      },
    });
  }

  function onRequestSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!request.isPending) sendRequest();
  }

  function onVerifySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (verify.isPending || !CODE_RE.test(code)) return;
    let profile: OtpVerifyIn['profile'];
    if (askProfile) {
      if (role === null) return;
      if (!nameIsValid(name)) {
        setNameError(true);
        nameRef.current?.focus();
        return;
      }
      setNameError(false);
      profile = { display_name: name.trim(), role };
    }
    setStep2Error(null);
    verify.mutate(
      { email: email.trim(), code, profile },
      {
        onSuccess: (result) => {
          if (result.kind === 'ok') {
            queryClient.setQueryData<UserOut | null>(ME_KEY, result.user);
            navigate(next);
            return;
          }
          if (result.kind === 'profileRequired' && !withProfile) {
            setProfileNeeded(true);
            return;
          }
          setStep2Error(result.kind === 'invalidCode' ? 'invalidCode' : 'failed');
          codeRef.current?.focus();
        },
      },
    );
  }

  function onResend() {
    setStep2Error(null);
    resend.mutate(email.trim(), {
      onSuccess: (result) => {
        if (result === 'ok') startCooldown();
        else setStep2Error(result === 'tooMany' ? 'tooMany' : 'failed');
      },
    });
  }

  function onChangeEmail() {
    setStep('request');
    setCode('');
    setStep2Error(null);
    setProfileNeeded(false);
    backToEmailRef.current = true;
  }

  const nameField = (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={`${id}-name`} className={label}>
        {t('auth.name.label')}
      </label>
      <input
        ref={nameRef}
        id={`${id}-name`}
        type="text"
        autoComplete="nickname"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setNameError(false);
        }}
        aria-invalid={nameError}
        aria-describedby={nameError ? `${id}-name-error` : undefined}
        className={`${input} text-start`}
      />
      {nameError && (
        <p id={`${id}-name-error`} role="alert" className={fieldError}>
          {t('auth.errors.nameLength')}
        </p>
      )}
    </div>
  );

  if (step === 'request') {
    return (
      <form noValidate onSubmit={onRequestSubmit} className="flex flex-col gap-[22px]">
        {withProfile && <RoleChoice value={role} onChange={setRole} />}
        {withProfile && nameField}
        <div className="flex flex-col gap-[6px]">
          <label htmlFor={`${id}-email`} className={label}>
            {t('auth.email.label')}
          </label>
          <input
            ref={emailRef}
            id={`${id}-email`}
            type="email"
            dir="ltr"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(false);
            }}
            aria-invalid={emailError}
            aria-describedby={emailError ? `${id}-email-error` : undefined}
            className={`${input} text-start`}
          />
          {emailError && (
            <p id={`${id}-email-error`} role="alert" className={fieldError}>
              {t('auth.errors.invalidEmail')}
            </p>
          )}
        </div>
        {step1Error === 'tooMany' && (
          <p role="alert" className={fieldError}>
            {t('auth.errors.tooMany')}
          </p>
        )}
        {step1Error === 'failed' && <ErrorState onRetry={sendRequest} />}
        <button
          type="submit"
          disabled={request.isPending || (withProfile && role === null)}
          aria-busy={request.isPending}
          className={primary}
        >
          {t('auth.sendCode')}
        </button>
      </form>
    );
  }

  const codeReady = CODE_RE.test(code) && (!askProfile || role !== null);
  const cooling = secondsLeft > 0;

  return (
    <form noValidate onSubmit={onVerifySubmit} className="flex flex-col gap-[22px]">
      <p className="text-muted">
        {/* First-strong isolates keep an email that ends in a digit or symbol in LTR order. */}
        {t('auth.code.sentTo', { email: `⁨${email.trim()}⁩` })}
      </p>
      <div className="flex flex-col gap-[6px]">
        <label htmlFor={`${id}-code`} className={label}>
          {t('auth.code.label')}
        </label>
        <input
          ref={codeRef}
          id={`${id}-code`}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          dir="ltr"
          maxLength={6}
          value={code}
          onPaste={(e) => {
            e.preventDefault();
            setCode(
              e.clipboardData
                .getData('text')
                .replace(/[^0-9]/g, '')
                .slice(0, 6),
            );
          }}
          onChange={(e) => {
            setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6));
          }}
          aria-invalid={step2Error === 'invalidCode'}
          aria-describedby={step2Error !== null ? `${id}-code-error` : undefined}
          className={`${input} text-start tracking-[0.3em]`}
        />
        {step2Error !== null && (
          <p id={`${id}-code-error`} role="alert" className={fieldError}>
            {step2Error === 'invalidCode'
              ? t('auth.errors.invalidCode')
              : step2Error === 'tooMany'
                ? t('auth.errors.tooMany')
                : t('common.error')}
          </p>
        )}
      </div>
      {profileNeeded && (
        <div className="flex flex-col gap-[22px]">
          <p>{t('auth.noAccountYet')}</p>
          <RoleChoice value={role} onChange={setRole} firstRadioRef={firstRadioRef} />
          {nameField}
        </div>
      )}
      <button
        type="submit"
        disabled={verify.isPending || !codeReady}
        aria-busy={verify.isPending}
        className={primary}
      >
        {t('auth.verify')}
      </button>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={onResend}
          disabled={cooling || resend.isPending}
          aria-busy={resend.isPending}
          className={secondary}
        >
          {cooling ? t('auth.resendIn', { seconds: secondsLeft }) : t('auth.resend')}
        </button>
        <button type="button" onClick={onChangeEmail} className={`${secondary} underline`}>
          {t('auth.changeEmail')}
        </button>
      </div>
    </form>
  );
}
