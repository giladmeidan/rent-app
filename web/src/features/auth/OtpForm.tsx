import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { api, type Role, type UserOut } from '../../api/client';
import type { components } from '../../api/schema';
import { CONTACT_EMAIL_INLINE } from '../../app/contact';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorState } from '../../components/ErrorState';
import { Field } from '../../components/Field';
import { PasswordInput } from '../../components/PasswordInput';
import { parseRetryAfter, retryAfterText } from '../../components/retryAfter';
import { TextInput } from '../../components/TextInput';
import { useOnline } from '../../components/useOnline';
import { passwordTooShort } from './password';
import { askRoleFor, ConsentLine, nameIsValid, ProfileFields } from './ProfileFields';
import { signedIn } from './signedIn';

type OtpVerifyIn = components['schemas']['OtpVerifyIn'];

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_RE = /^[0-9]{6}$/;
const RESEND_COOLDOWN_S = 30;

/** A 429 carries the API's `Retry-After` in seconds, or null when it is missing. */
export type TooMany = { kind: 'tooMany'; retryAfter: number | null };
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
  | { kind: 'suspended' }
  | { kind: 'signupBlocked' }
  | { kind: 'failed' };

/** True only for a body that is exactly `{"detail": <detail>}`. */
export function hasDetail(body: unknown, detail: string): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    Object.keys(body).length === 1 &&
    'detail' in body &&
    body.detail === detail
  );
}

async function verifyCode(body: OtpVerifyIn): Promise<VerifyResult> {
  try {
    const { data, error, response } = await api.POST('/auth/otp/verify', { body });
    if (data !== undefined && (response.status === 200 || response.status === 201)) {
      return { kind: 'ok', user: data };
    }
    if (response.status === 401) return { kind: 'invalidCode' };
    // A suspended account (0012a); any other 403 is a plain failure.
    if (response.status === 403 && hasDetail(error, 'account_suspended')) {
      return { kind: 'suspended' };
    }
    // A new account refused for an email Homie blocked (0013c).
    if (response.status === 403 && hasDetail(error, 'signup_blocked')) {
      return { kind: 'signupBlocked' };
    }
    if (response.status === 422 && hasDetail(error, 'profile_required')) {
      return { kind: 'profileRequired' };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' }; // network error
  }
}

/** The request errors' line (too many, a failed verify): the kit `Field`'s error text. */
export const errorText = 'text-body-sm text-danger';

type Props = {
  /** Signup: step 1 collects role and name too. Login: email only; the profile is asked for only
   * when verify answers `profile_required`. Started from the market (`next` on the market side,
   * no explicit role), the role is not asked and is stored as seeker (spec 0010b, Q10). */
  withProfile: boolean;
  initialRole?: Role | null;
  /** Where a successful verify goes: a path already checked by `safeNext`. */
  next?: string;
  /** The email field's first value (the password form's "log in with a code", spec 0016a). */
  initialEmail?: string;
};

type Step1Error = TooMany | { kind: 'failed' } | null;
type Step2Error =
  | TooMany
  | { kind: 'invalidCode' }
  | { kind: 'suspended' }
  | { kind: 'signupBlocked' }
  | { kind: 'failed' }
  | null;

/**
 * Two-step email-code form shared by /signup and /login. The email and code live in this
 * component's state only (never storage or the URL).
 */
export function OtpForm({ withProfile, initialRole = null, next = '/', initialEmail = '' }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const id = useId();
  const online = useOnline();

  // No roles in the market (spec 0010b): a signup or a new email's login headed there is not asked
  // owner or seeker. An explicit role (`?role=`) still shows the question, preset.
  const askRole = askRoleFor(initialRole, next);
  const [step, setStep] = useState<'request' | 'verify'>('request');
  const [role, setRole] = useState<Role | null>(askRole ? initialRole : 'seeker');
  const [name, setName] = useState('');
  const [email, setEmail] = useState(initialEmail);
  // Signup only (spec 0016a): optional, sent as `profile.password` when not empty.
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [code, setCode] = useState('');
  // Login only: the email has no account yet, so step 2 also asks for role (unless `askRole` is
  // false) and name.
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
  const passwordRef = useRef<HTMLInputElement>(null);
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
    if (!profileNeeded) return;
    // The first `role` radio in the DOM is the owner's; without the question, the name.
    if (askRole) formRef.current?.querySelector<HTMLInputElement>('input[name="role"]')?.focus();
    else nameRef.current?.focus();
  }, [profileNeeded, askRole]);

  function sendRequest() {
    const nameOk = !withProfile || nameIsValid(name);
    const passwordOk = !withProfile || !passwordTooShort(password);
    const emailOk = EMAIL_RE.test(email.trim());
    setNameError(!nameOk);
    setPasswordError(!passwordOk);
    setEmailError(!emailOk);
    setStep1Error(null);
    if (!nameOk) {
      nameRef.current?.focus();
      return;
    }
    if (!passwordOk) {
      passwordRef.current?.focus();
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
      if (withProfile && password !== '') profile.password = password;
    }
    setStep2Error(null);
    verify.mutate(
      { email: email.trim(), code, profile },
      {
        onSuccess: (result) => {
          if (result.kind === 'ok') {
            signedIn(queryClient, navigate, result.user, next);
            return;
          }
          if (result.kind === 'profileRequired' && !withProfile) {
            setProfileNeeded(true);
            return;
          }
          if (result.kind === 'suspended' || result.kind === 'signupBlocked') {
            // The code was right and is now used up: a cleared field, and the alert (0012a, 0013c).
            setCode('');
            setStep2Error({ kind: result.kind });
          } else {
            setStep2Error({ kind: result.kind === 'invalidCode' ? 'invalidCode' : 'failed' });
          }
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

  const profileFields = (
    <ProfileFields
      id={id}
      askRole={askRole}
      role={role}
      onRoleChange={setRole}
      name={name}
      onNameChange={(value) => {
        setName(value);
        setNameError(false);
      }}
      nameError={nameError}
      nameRef={nameRef}
    />
  );

  const passwordField = (
    <Field
      id={`${id}-password`}
      label={t('auth.password.optionalLabel')}
      hint={t('auth.password.hint')}
      error={passwordError ? t('auth.password.tooShort') : undefined}
    >
      <PasswordInput
        ref={passwordRef}
        name="password"
        autoComplete="new-password"
        maxLength={128}
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
          setPasswordError(false);
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
        {withProfile && profileFields}
        {withProfile && passwordField}
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
            : step2Error.kind === 'suspended'
              ? t('auth.errors.suspended')
              : step2Error.kind === 'signupBlocked'
                ? t('auth.errors.signupBlocked', { email: CONTACT_EMAIL_INLINE })
                : online
                  ? t('common.error')
                  : t('common.offline')}
        </p>
      )}
      {profileNeeded && (
        <Card variant="muted" padding="md" className="flex flex-col gap-6">
          <p className="text-body">{t('auth.noAccountYet')}</p>
          {profileFields}
        </Card>
      )}
      <div className="flex flex-col gap-1.5">
        {/* The verify that sends the profile creates the account. */}
        {askProfile && <ConsentLine />}
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
