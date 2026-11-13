import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../components/Button';
import { Tag } from '../../components/Tag';
import { checkFile, MAX_PHOTOS, PHOTO_ACCEPT } from '../photos/limits';
import type { WizardPhoto } from './syncPhotos';

type Props = {
  photos: WizardPhoto[];
  onChange: (photos: WizardPhoto[]) => void;
};

/** Where focus goes once the list has re-rendered. */
type FocusTarget =
  | { kind: 'button'; key: string; action: 'earlier' | 'later' | 'remove' }
  | { kind: 'add' }
  | { kind: 'count' };

let lastLocalId = 0;
const nextLocalId = () => {
  lastLocalId += 1;
  return `new-${String(lastLocalId)}`;
};

const keyOf = (photo: WizardPhoto) => (photo.kind === 'stored' ? photo.id : photo.localId);

function icon(path: string, flip: boolean) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={flip ? 'ltr:rotate-180' : undefined}
    >
      <path d={path} />
    </svg>
  );
}

// The wizard's chevrons: in RTL "earlier" points to the start side (right).
const EARLIER = icon('M9 6l6 6-6 6', true);
const LATER = icon('M15 6l-6 6 6 6', true);
const REMOVE = icon('M6 6l12 12M18 6L6 18', false);
const PLUS = icon('M12 5v14M5 12h14', false);

/**
 * The wizard's photos step (spec 0010e): up to `MAX_PHOTOS` photos, the first the cover. Files are
 * checked here (type, size, room left) and kept in the browser; the wizard uploads them after the
 * publish or save. The step's heading and hint are the wizard's. Object URLs are made here, when
 * files are picked, and revoked here when a photo is removed (the wizard revokes the rest when it
 * unmounts).
 */
export function PhotosStep({ photos, onChange }: Props) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const countRef = useRef<HTMLParagraphElement>(null);
  const focusAfter = useRef<FocusTarget | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const full = photos.length >= MAX_PHOTOS;

  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    if (target.kind === 'add') addRef.current?.focus();
    else if (target.kind === 'count') countRef.current?.focus();
    else {
      const tile = listRef.current?.querySelector(`[data-photo="${target.key}"]`);
      const button = (action: string) =>
        tile?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`) ?? null;
      let element = button(target.action);
      // A move into the first or last place: that button is now disabled; the other one moves on.
      if (element?.disabled === true) {
        element = button(target.action === 'earlier' ? 'later' : 'earlier');
      }
      element?.focus();
    }
  }, [photos]);

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // The same file can be picked again after a removal.
    event.target.value = '';
    let room = MAX_PHOTOS - photos.length;
    let badType = false;
    let badSize = false;
    let tooMany = 0;
    const added: WizardPhoto[] = [];
    for (const file of files) {
      const problem = checkFile(file);
      if (problem === 'type') badType = true;
      else if (problem === 'size') badSize = true;
      else if (room === 0) tooMany += 1;
      else {
        room -= 1;
        added.push({ kind: 'new', localId: nextLocalId(), file, url: URL.createObjectURL(file) });
      }
    }
    const reasons = [
      ...(badType ? [t('photos.errors.type')] : []),
      ...(badSize ? [t('photos.errors.size')] : []),
      ...(tooMany > 0 ? [t('listings.photos.tooMany', { count: tooMany })] : []),
    ];
    setRejected(reasons.length > 0 ? reasons.join(' ') : null);
    if (added.length === 0) return;
    if (photos.length + added.length >= MAX_PHOTOS) focusAfter.current = { kind: 'count' };
    onChange([...photos, ...added]);
  }

  function move(index: number, by: -1 | 1) {
    const photo = photos[index];
    const other = photos[index + by];
    if (photo === undefined || other === undefined) return;
    const next = [...photos];
    next[index] = other;
    next[index + by] = photo;
    focusAfter.current = {
      kind: 'button',
      key: keyOf(photo),
      action: by === -1 ? 'earlier' : 'later',
    };
    onChange(next);
  }

  function remove(index: number) {
    const photo = photos[index];
    if (photo === undefined) return;
    if (photo.kind === 'new') URL.revokeObjectURL(photo.url);
    const next = photos.filter((_, i) => i !== index);
    const neighbour = next[index] ?? next[index - 1];
    focusAfter.current =
      neighbour === undefined
        ? { kind: 'add' }
        : { kind: 'button', key: keyOf(neighbour), action: 'remove' };
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-4">
      {photos.length > 0 && (
        <ul ref={listRef} className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {photos.map((photo, i) => {
            const n = i + 1;
            return (
              <li key={keyOf(photo)} data-photo={keyOf(photo)} className="flex flex-col gap-2">
                <div className="relative aspect-[16/10] overflow-hidden rounded-md bg-surface-subtle">
                  <img
                    src={photo.url}
                    alt={t('listings.photos.tileAlt', { n })}
                    decoding="async"
                    className="absolute inset-0 size-full object-cover"
                  />
                  {i === 0 && (
                    <Tag size="sm" tone="inverse" className="absolute start-2 top-2">
                      {t('listings.photos.cover')}
                    </Tag>
                  )}
                </div>
                <div className="flex justify-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    data-action="earlier"
                    aria-label={t('listings.photos.moveEarlier', { n })}
                    icon={EARLIER}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    data-action="later"
                    aria-label={t('listings.photos.moveLater', { n })}
                    icon={LATER}
                    disabled={i === photos.length - 1}
                    onClick={() => move(i, 1)}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    data-action="remove"
                    aria-label={t('listings.photos.remove', { n })}
                    icon={REMOVE}
                    onClick={() => remove(i)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {!full && (
          <Button
            ref={addRef}
            variant="secondary"
            icon={PLUS}
            onClick={() => inputRef.current?.click()}
          >
            {t('listings.photos.add')}
          </Button>
        )}
        {photos.length > 0 && (
          <p
            ref={countRef}
            tabIndex={-1}
            className="text-body-sm text-ink-muted focus:outline-none"
          >
            {t('listings.photos.count', { count: photos.length })}
          </p>
        )}
      </div>
      {photos.length === 0 && (
        <p className="text-body-sm text-ink-muted">{t('listings.photos.empty')}</p>
      )}
      {rejected !== null && (
        <p role="alert" className="text-body-sm font-medium text-danger">
          {rejected}
        </p>
      )}
      <input ref={inputRef} type="file" multiple accept={PHOTO_ACCEPT} onChange={onPick} hidden />
    </div>
  );
}
