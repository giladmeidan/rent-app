import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { Button } from '../../components/Button';
import { cx } from '../../components/cx';
import { Dialog } from '../../components/Dialog';
import { focusRing } from '../../components/focusRing';
import { useOnline } from '../../components/useOnline';
import { loginWithNext } from '../auth/next';
import { useLogout } from '../auth/useLogout';
import { isReauthRequired, useDeleteAccount } from './useDeleteAccount';

/**
 * The profile's "מחיקת החשבון" section (spec 0013f), after the form: what is deleted, a link to
 * what is kept, and a danger button that opens the confirm dialog. The dialog has four states:
 * confirm, pending, reauth (the session is over 15 minutes old: sign in again, then come back) and
 * failed (an alert, the button usable again).
 */
export function DeleteAccountSection({ className }: { className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const del = useDeleteAccount();
  const logout = useLogout();

  const reauth = del.isError && isReauthRequired(del.error);
  // The alert: the sign-out that failed (reauth state) or any failure but the reauth one.
  const failure = logout.isError
    ? t('common.error')
    : del.isError && !reauth
      ? t('profile.delete.failed')
      : null;
  // One request per confirmation, even on a double click (the pending state arrives a render late).
  const sent = useRef(false);

  function confirmDelete() {
    if (sent.current) return;
    sent.current = true;
    del.mutate(undefined, {
      onError: () => {
        sent.current = false;
      },
    });
  }

  function close() {
    // Nothing is cancelled mid-request: the answer decides where the person goes.
    if (del.isPending) return;
    setOpen(false);
    del.reset();
    logout.reset();
  }

  function signInAgain() {
    // `useLogout` forgets the session; the guard then sends the person to the login page, and
    // this makes the way back to the profile explicit. The page may be gone by then: a promise,
    // not `mutate`'s callbacks, which die with the component.
    logout
      .mutateAsync()
      .then(() =>
        navigate(loginWithNext({ pathname: '/me/profile', search: '' }), { replace: true }),
      )
      .catch(() => undefined);
  }

  const headingId = 'profile-delete-title';
  return (
    <section
      id="profile-delete"
      aria-labelledby={headingId}
      className={cx('flex flex-col items-start gap-4 border-t border-border pt-8', className)}
    >
      <h2 id={headingId} className="font-display text-h2">
        {t('profile.delete.title')}
      </h2>
      <p className="text-body-sm text-ink-muted">{t('profile.delete.body')}</p>
      <Link
        to="/privacy#deletion"
        className={cx(
          'inline-flex min-h-tap items-center rounded-md text-body-sm font-medium text-accent underline underline-offset-4 hover:text-accent-strong',
          focusRing,
        )}
      >
        {t('profile.delete.privacyLink')}
      </Link>
      <Button variant="danger" onClick={() => setOpen(true)}>
        {t('profile.delete.open')}
      </Button>
      <Dialog
        open={open}
        onClose={close}
        title={t('profile.delete.confirmTitle')}
        description={reauth ? t('profile.delete.reauth') : t('profile.delete.confirmBody')}
        initialFocusRef={cancelRef}
        actions={
          <>
            <Button ref={cancelRef} variant="secondary" onClick={close} disabled={del.isPending}>
              {t('common.cancel')}
            </Button>
            {reauth ? (
              <Button variant="primary" onClick={signInAgain} busy={logout.isPending}>
                {t('profile.delete.reauthAction')}
              </Button>
            ) : (
              <Button variant="danger" onClick={confirmDelete} disabled={del.isPending}>
                {del.isPending ? t('profile.delete.pending') : t('profile.delete.confirm')}
              </Button>
            )}
          </>
        }
      >
        {failure !== null && (
          <p role="alert" className="text-body-sm text-danger">
            {online ? failure : t('common.offline')}
          </p>
        )}
      </Dialog>
    </section>
  );
}
