import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { Field } from '../../components/Field';
import { PasswordInput } from '../../components/PasswordInput';
import { retryAfterText } from '../../components/retryAfter';
import { useOnline } from '../../components/useOnline';
import { loginWithNext } from '../auth/next';
import { passwordTooShort } from '../auth/password';
import { useLogout } from '../auth/useLogout';
import { useMe } from '../auth/useMe';
import { ApiError } from '../listings/api';
import { isReauthRequired } from './useDeleteAccount';
import { useSetPassword } from './useSetPassword';

/**
 * The profile's "סיסמה" section (spec 0016a), above "מחיקת החשבון" and with its anatomy: says
 * whether the person has a password, and sets or changes it from a sign-in of the last 15 minutes
 * (else: sign in again, then come back). Saving signs out every other device.
 */
export function PasswordSection({ className }: { className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const online = useOnline();
  const id = useId();
  const me = useMe();
  const save = useSetPassword();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [tooShort, setTooShort] = useState(false);
  const [saved, setSaved] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Opening goes to the field; closing (saved or cancelled) back to the button.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    else if (wasOpen.current) openRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  if (!me.data) return null;
  const hasPassword = me.data.has_password;
  const reauth = save.isError && isReauthRequired(save.error);

  function close() {
    setOpen(false);
    setPassword('');
    setTooShort(false);
    save.reset();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending) return;
    if (password === '' || passwordTooShort(password)) {
      setTooShort(true);
      inputRef.current?.focus();
      return;
    }
    save.mutate(password, {
      onSuccess: () => {
        close();
        setSaved(true);
      },
    });
  }

  function signInAgain() {
    // As `DeleteAccountSection`: a promise, not `mutate`'s callbacks, which die with the page.
    logout
      .mutateAsync()
      .then(() =>
        navigate(loginWithNext({ pathname: '/me/profile', search: '' }), { replace: true }),
      )
      .catch(() => undefined);
  }

  let failure: string | null = null;
  if (logout.isError) failure = t('common.error');
  else if (save.isError && !reauth) {
    const error = save.error;
    failure =
      error instanceof ApiError && error.status === 429
        ? error.retryAfter === null
          ? t('auth.errors.tooMany')
          : t('auth.errors.tooManyIn', { when: retryAfterText(t, error.retryAfter) })
        : online
          ? t('common.error')
          : t('common.offline');
  }

  const headingId = 'profile-password-title';
  return (
    <section
      id="profile-password"
      aria-labelledby={headingId}
      className={cx('flex flex-col items-start gap-4 border-t border-border pt-8', className)}
    >
      <h2 id={headingId} className="font-display text-h2">
        {t('profile.password.title')}
      </h2>
      <p className="text-body-sm text-ink-muted">
        {hasPassword ? t('profile.password.has') : t('profile.password.none')}
      </p>
      {open ? (
        <form noValidate onSubmit={onSubmit} className="flex w-full flex-col gap-4">
          <Field
            id={`${id}-password`}
            label={t('profile.password.newLabel')}
            hint={t('auth.password.hint')}
            error={tooShort ? t('auth.password.tooShort') : undefined}
            className="w-full"
          >
            <PasswordInput
              ref={inputRef}
              name="password"
              autoComplete="new-password"
              maxLength={128}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setTooShort(false);
              }}
            />
          </Field>
          {reauth && (
            <div role="alert" className="flex flex-col items-start gap-2">
              <p className="text-body-sm">{t('profile.password.reauth')}</p>
              <Button variant="primary" onClick={signInAgain} busy={logout.isPending}>
                {t('profile.password.reauthAction')}
              </Button>
            </div>
          )}
          {failure !== null && (
            <p role="alert" className="text-body-sm text-danger">
              {failure}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" busy={save.isPending}>
              {t('profile.password.save')}
            </Button>
            <Button variant="secondary" onClick={close} disabled={save.isPending}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          ref={openRef}
          variant="secondary"
          onClick={() => {
            setSaved(false);
            setOpen(true);
          }}
        >
          {hasPassword ? t('profile.password.change') : t('profile.password.set')}
        </Button>
      )}
      <p role="status" className="text-body-sm text-ink-muted">
        {saved ? t('profile.password.saved') : ''}
      </p>
    </section>
  );
}
