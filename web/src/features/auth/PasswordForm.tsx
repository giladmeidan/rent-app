import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { api, type UserOut } from '../../api/client';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { PasswordInput } from '../../components/PasswordInput';
import { parseRetryAfter, retryAfterText } from '../../components/retryAfter';
import { TextInput } from '../../components/TextInput';
import { useOnline } from '../../components/useOnline';
import { signedIn } from './signedIn';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type LoginResult =
  | { kind: 'ok'; user: UserOut }
  | { kind: 'invalid' }
  | { kind: 'suspended' }
  | { kind: 'tooMany'; retryAfter: number | null }
  | { kind: 'failed' };

async function passwordLogin(body: { email: string; password: string }): Promise<LoginResult> {
  try {
    const { data, response } = await api.POST('/auth/password/login', { body });
    if (data !== undefined && response.status === 200) return { kind: 'ok', user: data };
    if (response.status === 401) return { kind: 'invalid' };
    if (response.status === 403) return { kind: 'suspended' };
    if (response.status === 429) {
      return { kind: 'tooMany', retryAfter: parseRetryAfter(response.headers) };
    }
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' }; // network error
  }
}

type Props = {
  /** Where a successful login goes: a path already checked by `safeNext`. */
  next: string;
  /** "Forgot password? Log in with a code": switches to code mode with the typed email. */
  onUseCode: (email: string) => void;
};

/** Email + password login (spec 0016a). The password lives in this component's state only. */
export function PasswordForm({ next, onUseCode }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const id = useId();
  const online = useOnline();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<'required' | 'invalid' | null>(null);
  const [passwordMissing, setPasswordMissing] = useState(false);
  const [result, setResult] = useState<Exclude<LoginResult, { kind: 'ok' }> | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const login = useMutation({ mutationFn: passwordLogin, gcTime: 0 });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (login.isPending) return;
    const trimmed = email.trim();
    const badEmail = trimmed === '' ? 'required' : EMAIL_RE.test(trimmed) ? null : 'invalid';
    setEmailError(badEmail);
    setPasswordMissing(password === '');
    setResult(null);
    if (badEmail !== null) {
      emailRef.current?.focus();
      return;
    }
    if (password === '') {
      passwordRef.current?.focus();
      return;
    }
    login.mutate(
      { email: trimmed, password },
      {
        onSuccess: (answer) => {
          if (answer.kind === 'ok') {
            signedIn(queryClient, navigate, answer.user, next);
            return;
          }
          if (answer.kind === 'invalid') setPassword('');
          setResult(answer);
          passwordRef.current?.focus();
        },
      },
    );
  }

  const alertId = `${id}-error`;
  let alert: string | null = null;
  if (result?.kind === 'invalid') alert = t('auth.password.invalid');
  else if (result?.kind === 'suspended') alert = t('auth.errors.suspended');
  else if (result?.kind === 'tooMany') {
    alert =
      result.retryAfter === null
        ? t('auth.errors.tooMany')
        : t('auth.errors.tooManyIn', { when: retryAfterText(t, result.retryAfter) });
  } else if (result?.kind === 'failed') alert = online ? t('common.error') : t('common.offline');

  return (
    <div className="flex flex-col gap-6">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
        <Field
          id={`${id}-email`}
          label={t('auth.email.label')}
          error={
            emailError === 'required'
              ? t('listings.errors.required')
              : emailError === 'invalid'
                ? t('auth.errors.invalidEmail')
                : undefined
          }
        >
          <TextInput
            ref={emailRef}
            type="email"
            name="email"
            dir="ltr"
            autoComplete="username"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
          />
        </Field>
        <Field
          id={`${id}-password`}
          label={t('auth.password.label')}
          error={passwordMissing ? t('listings.errors.required') : undefined}
        >
          <PasswordInput
            ref={passwordRef}
            name="password"
            autoComplete="current-password"
            maxLength={128}
            value={password}
            aria-describedby={alert !== null ? alertId : undefined}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordMissing(false);
            }}
          />
        </Field>
        {alert !== null && (
          <p id={alertId} role="alert" className="text-body-sm text-danger">
            {alert}
          </p>
        )}
        <Button
          variant="primary"
          size="lg"
          fullWidth
          type="submit"
          disabled={login.isPending}
          aria-busy={login.isPending}
        >
          {t('auth.password.submit')}
        </Button>
      </form>
      <p className="text-body text-ink-muted">
        {t('auth.password.forgot')}{' '}
        <Button variant="ghost" size="sm" onClick={() => onUseCode(email.trim())}>
          {t('auth.password.forgotAction')}
        </Button>
      </p>
    </div>
  );
}
