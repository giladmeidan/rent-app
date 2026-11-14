import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { UserOut } from '../../api/client';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { ME_KEY, useMe } from '../auth/useMe';
import { checkFile, PHOTO_ACCEPT } from '../photos/limits';
import { photoErrorText } from '../photos/errors';
import { deleteMyPhoto, uploadMyPhoto } from './photoApi';

type Busy = 'upload' | 'remove' | null;
type Done = 'saved' | 'removed' | null;

/**
 * The caller's own photo at the top of the profile's "עליי" section (spec 0010k): shown whether
 * the section's switch is on or off, and saved on its own (not with the profile form), so every
 * pick or removal is sent at once. Re-uploading undoes a removal, so there is no confirmation.
 */
export function PersonPhoto() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const me = useMe().data;
  const [busy, setBusy] = useState<Busy>(null);
  const [done, setDone] = useState<Done>(null);
  const [error, setError] = useState<string | null>(null);
  // One request at a time: a second pick or removal while one is in flight is ignored.
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // Set by a removal: the "add" button replaces "replace", so focus moves there once it is shown.
  const [focusAdd, setFocusAdd] = useState(false);
  const hasPhoto = me?.photo_url != null;
  useEffect(() => {
    if (focusAdd && !hasPhoto && addButton.current !== null) {
      addButton.current.focus();
      setFocusAdd(false);
    }
  }, [focusAdd, hasPhoto]);

  if (me == null) return null;

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // The same file can be picked again after a failure.
    event.target.value = '';
    if (file === undefined || inFlight.current) return;
    const problem = checkFile(file);
    if (problem !== null) {
      setDone(null);
      setError(t(problem === 'type' ? 'photos.errors.type' : 'photos.errors.size'));
      return;
    }
    inFlight.current = true;
    setBusy('upload');
    setDone(null);
    setError(null);
    try {
      const user = await uploadMyPhoto(file);
      queryClient.setQueryData<UserOut | null>(ME_KEY, user);
      setDone('saved');
    } catch (failure) {
      setError(photoErrorText(t, failure));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function onRemove() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy('remove');
    setDone(null);
    setError(null);
    try {
      await deleteMyPhoto();
      queryClient.setQueryData<UserOut | null>(ME_KEY, (user) =>
        user == null ? user : { ...user, photo_url: null },
      );
      setDone('removed');
      setFocusAdd(true);
    } catch (failure) {
      setError(photoErrorText(t, failure));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  const pick = () => input.current?.click();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <Avatar name={me.display_name} photoUrl={me.photo_url} size="xl" />
        <div className="flex min-w-0 flex-col items-start gap-2">
          <div className="flex flex-wrap gap-2">
            {hasPhoto ? (
              <>
                <Button variant="secondary" size="md" busy={busy === 'upload'} onClick={pick}>
                  {t('profile.photo.replace')}
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  busy={busy === 'remove'}
                  onClick={() => void onRemove()}
                >
                  {t('profile.photo.remove')}
                </Button>
              </>
            ) : (
              <Button
                ref={addButton}
                variant="secondary"
                size="md"
                busy={busy === 'upload'}
                onClick={pick}
              >
                {t('profile.photo.add')}
              </Button>
            )}
          </div>
          <p role="status" className="text-body-sm font-medium text-success empty:hidden">
            {done === null
              ? ''
              : t(done === 'saved' ? 'profile.photo.saved' : 'profile.photo.removed')}
          </p>
          {error !== null && (
            <p role="alert" className="text-body-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
      <p className="text-body-sm text-ink-muted">{t('profile.photo.hint')}</p>
      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
        className="hidden"
        tabIndex={-1}
        onChange={(event) => void onPick(event)}
      />
    </div>
  );
}
