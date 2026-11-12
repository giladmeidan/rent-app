import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { api, type Role, type UserOut } from '../../api/client';
import type { components } from '../../api/schema';
import { clearDraftsExcept } from '../../app/drafts';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ChoiceGroup, type ChoiceOption } from '../../components/ChoiceGroup';
import { ErrorState } from '../../components/ErrorState';
import { Field } from '../../components/Field';
import { parseRetryAfter, retryAfterText } from '../../components/retryAfter';
import { TextInput } from '../../components/TextInput';
import { useOnline } from '../../components/useOnline';
import { safeNext } from './next';
import { clearSession } from './useLogout';
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

/** A 429 carries the API's `Retry-After` in seconds, or null when it is missing. */
type TooMany = { kind: 'tooMany'; retryAfter: number | null };
type RequestResult = { kind: 'ok' } | { kind: 'invalidEmail' } | TooMany | { kind: 'failed' };

async function requestCode(email: string): Promise<RequestResult> {
  try {
    const { response } = await api.POST('/auth/otp/request', { body: { email } });
    if (response.status === 204) return { kind: 'ok' };
    if (response.status === 422) return { kind: 'invalidEmail' };
    if (response.status === 429) {
      return { kind: 'tooMany', retryAfter: parseRetryAfter(response.headers) };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' }; // network error
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

/** The request errors' line (too many, a failed verify): the kit `Field`'s error text. */
const errorText = 'text-body-sm text-danger';

type Props = {
  /** Signup: step 1 collects role and name too. Login: email only; the profile is asked for only
   * when verify answers `profile_required`. */
  withProfile: boolean;
  initialRole?: Role | null;
  /** Where a successful verify goes: a path already checked by `safeNext`. */
  next?: string;
};

type Step1Error = TooMany | { kind: 'failed' } | null;
type Step2Error = TooMany | { kind: 'invalidCode' } | { kind: 'failed' } | null;

/**
 * Two-step email-code form shared by /signup and /login. The email and code live in this
 * component's state only (never storage or the URL).
 */
export function OtpForm({ withProfile, initialRole = null, next = '/' }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const id = useId();
  const online = useOnline();

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
  // The verify step's status line (spec 0009t): "code resent" after a resend, "you can resend"
  // when a cooldown ends, empty otherwise. The visible countdown stays silent.
  const [resendStatus, setResendStatus] = useState<'resent' | 'ready' | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const backToEmailRef = useRef(false);

  const request = useMutation({ mutationFn: requestCode, gcTime: 0 });
  const resend = useMutation({ mutationFn: requestCode, gcTime: 0 });
  const verify = useMutation({ mutationFn: verifyCode, gcTime: 0 });

  const askProfile = withProfile || profileNeeded;

  function startCooldown() {
    setResendStatus(null);
    setResendDeadline(Date.now() + RESEND_COOLDOWN_S * 1000);
    setSecondsLeft(RESEND_COOLDOWN_S);
  }

  // Count down from the deadline, so a throttled background tab still ends on time.
  useEffect(() => {
    if (resendDeadline === null) return;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((resendDeadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0) {
        clearInterval(timer);
        setResendStatus('ready');
      }
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
    // The first `role` radio in the DOM is the owner's.
    if (profileNeeded)
      formRef.current?.querySelector<HTMLInputElement>('input[name="role"]')?.focus();
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
        if (result.kind === 'ok') {
          setCode('');
          setStep2Error(null);
          startCooldown();
          setStep('verify');
        } else if (result.kind === 'invalidEmail') {
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
            // Drop whatever the previous person in this tab left under ['me', …] first. A stashed
            // invite token stays: it is this login's way back to the join page (0008e A1).
            clearSession(queryClient, { keepInviteToken: true });
            // Another person's unsent text in this tab is never theirs (spec 0009g).
            clearDraftsExcept(result.user.id);
            queryClient.setQueryData<UserOut | null>(ME_KEY, result.user);
            // `replace`: Back does not return to /login. `safeNext` again, as defence in depth.
            navigate(safeNext(next), { replace: true });
            return;
          }
          if (result.kind === 'profileRequired' && !withProfile) {
            setProfileNeeded(true);
            return;
          }
          setStep2Error({ kind: result.kind === 'invalidCode' ? 'invalidCode' : 'failed' });
          codeRef.current?.focus();
        },
      },
    );
  }

  function onResend() {
    setStep2Error(null);
    setResendStatus(null);
    resend.mutate(email.trim(), {
      onSuccess: (result) => {
        if (result.kind === 'ok') {
          startCooldown();
          setResendStatus('resent');
          // The cooldown disables the focused resend button: focus goes back to the code.
          codeRef.current?.focus();
        } else setStep2Error(result.kind === 'tooMany' ? result : { kind: 'failed' });
      },
    });
  }

  /** "יותר מדי ניסיונות…", naming the wait when the API sent one. */
  function tooManyText(error: TooMany): string {
    return error.retryAfter === null
      ? t('auth.errors.tooMany')
      : t('auth.errors.tooManyIn', { when: retryAfterText(t, error.retryAfter) });
  }

  function onChangeEmail() {
    setStep('request');
    setCode('');
    setStep2Error(null);
    setProfileNeeded(false);
    backToEmailRef.current = true;
  }

  const roleOptions: readonly ChoiceOption<Role>[] = [
    // Owner first: it sits at the inline start (the right, in RTL).
    { value: 'owner', label: t('auth.role.owner') },
    { value: 'seeker', label: t('auth.role.seeker') },
  ];
  const roleChoice = (
    <ChoiceGroup
      legend={t('auth.role.label')}
      name="role"
      options={roleOptions}
      value={role}
      onChange={setRole}
    />
  );

  const nameField = (
    <Field
      id={`${id}-name`}
      label={t('auth.name.label')}
      error={nameError ? t('auth.errors.nameLength') : undefined}
    >
      <TextInput
        ref={nameRef}
        type="text"
        autoComplete="nickname"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setNameError(false);
        }}
      />
    </Field>
  );

  const hintId = `${id}-submit-hint`;
  // Why the submit button is disabled for a missing input; never while a request is pending.
  const requestHint =
    !request.isPending && withProfile && role === null ? t('auth.hint.chooseRole') : null;

  if (step === 'request') {
    return (
      <form noValidate onSubmit={onRequestSubmit} className="flex flex-col gap-6">
        {withProfile && roleChoice}
        {withProfile && nameField}
        <Field
          id={`${id}-email`}
          label={t('auth.email.label')}
          error={emailError ? t('auth.errors.invalidEmail') : undefined}
        >
          <TextInput
            ref={emailRef}
            type="email"
            dir="ltr"
            autoComplete="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(false);
            }}
          />
        </Field>
        {step1Error?.kind === 'tooMany' && (
          <p role="alert" className={errorText}>
            {tooManyText(step1Error)}
          </p>
        )}
        {step1Error?.kind === 'failed' && <ErrorState onRetry={sendRequest} />}
        <div className="flex flex-col gap-1.5">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            type="submit"
            disabled={request.isPending || requestHint !== null}
            aria-busy={request.isPending}
            aria-describedby={requestHint !== null ? hintId : undefined}
          >
            {t('auth.sendCode')}
          </Button>
          {requestHint !== null && (
            <p id={hintId} className="text-sm text-ink-muted">
              {requestHint}
            </p>
          )}
        </div>
      </form>
    );
  }

  const codeReady = CODE_RE.test(code) && (!askProfile || role !== null);
  const cooling = secondsLeft > 0;
  let verifyHint: string | null = null;
  if (!verify.isPending && !CODE_RE.test(code)) verifyHint = t('auth.hint.enterCode');
  else if (!verify.isPending && askProfile && role === null) verifyHint = t('auth.hint.chooseRole');
  // A wrong code is the field's own error (the input is invalid); "too many" and a failure are
  // a separate alert that describes the input without marking it invalid.
  const codeInvalid = step2Error?.kind === 'invalidCode';
  const codeAlertId = `${id}-code-error`;

  return (
    <form ref={formRef} noValidate onSubmit={onVerifySubmit} className="flex flex-col gap-6">
      <p className="text-body text-ink-muted">
        {/* First-strong isolates keep an email that ends in a digit or symbol in LTR order. */}
        {t('auth.code.sentTo', { email: `⁨${email.trim()}⁩` })}
      </p>
      <Field
        id={`${id}-code`}
        label={t('auth.code.label')}
        error={codeInvalid ? t('auth.errors.invalidCode') : undefined}
      >
        <TextInput
          ref={codeRef}
          size="lg"
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
          aria-describedby={step2Error !== null && !codeInvalid ? codeAlertId : undefined}
        />
      </Field>
      {step2Error !== null && step2Error.kind !== 'invalidCode' && (
        <p id={codeAlertId} role="alert" className={errorText}>
          {step2Error.kind === 'tooMany'
            ? tooManyText(step2Error)
            : online
              ? t('common.error')
              : t('common.offline')}
        </p>
      )}
      {profileNeeded && (
        <Card variant="muted" padding="md" className="flex flex-col gap-6">
          <p className="text-body">{t('auth.noAccountYet')}</p>
          {roleChoice}
          {nameField}
        </Card>
      )}
      <div className="flex flex-col gap-1.5">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          type="submit"
          disabled={verify.isPending || !codeReady}
          aria-busy={verify.isPending}
          aria-describedby={verifyHint !== null ? hintId : undefined}
        >
          {t('auth.verify')}
        </Button>
        {verifyHint !== null && (
          <p id={hintId} className="text-sm text-ink-muted">
            {verifyHint}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onResend}
          disabled={cooling || resend.isPending}
          aria-busy={resend.isPending}
        >
          {cooling ? t('auth.resendIn', { count: secondsLeft }) : t('auth.resend')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onChangeEmail}>
          {t('auth.changeEmail')}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {resendStatus === 'resent'
          ? t('auth.codeResent')
          : resendStatus === 'ready'
            ? t('auth.resendReady')
            : ''}
      </p>
    </form>
  );
}
