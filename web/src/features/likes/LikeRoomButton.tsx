import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { roomSectionHref } from '../profile/links';
import type { LikeStateOut } from './api';
import { likeProblem, useLikeRoom, useUnlikeRoom } from './useLikeRoom';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const fieldError = 'text-sm font-semibold text-[#B91C1C]';

type Props = {
  listingId: string;
  like: LikeStateOut;
  /** Called with the application's id when this like made the pair mutual. */
  onMutual: (applicationId: string) => void;
  /** The listing page's one-line hint under an idle button. */
  showHint?: boolean;
};

/**
 * The room like toggle (`aria-pressed`), with the "the lister liked you" line above it. It is
 * disabled while its request runs. A like never refetches the listing (`useLikeRoom`).
 */
export function LikeRoomButton({ listingId, like, onMutual, showHint = false }: Props) {
  const { t } = useTranslation();
  const location = useLocation();
  const liking = useLikeRoom(listingId);
  const unliking = useUnlikeRoom(listingId);
  const pending = liking.isPending || unliking.isPending;
  const problem = likeProblem(liking.error ?? unliking.error);
  const pressed = like.liked_by_me;
  const hintId = useId();
  const hint = showHint && !like.liked_by_me && !like.liked_me;
  // Same-tick guard: a double click sends one request.
  const inFlight = useRef(false);

  function onClick() {
    if (inFlight.current) return;
    inFlight.current = true;
    const settled = () => {
      inFlight.current = false;
    };
    if (pressed) {
      liking.reset();
      unliking.mutate(undefined, { onSettled: settled });
    } else {
      unliking.reset();
      liking.mutate(undefined, {
        onSettled: settled,
        onSuccess: (result) => {
          if (result.application_id !== null) onMutual(result.application_id);
        },
      });
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {like.liked_me && !pressed && (
        <p className="text-start text-[15px] font-bold text-accent-text">
          {t('likes.likedYouLine')}
        </p>
      )}
      <button
        type="button"
        aria-pressed={pressed}
        disabled={pending}
        aria-busy={pending}
        aria-describedby={hint ? hintId : undefined}
        onClick={onClick}
        className={`inline-flex min-h-[44px] items-center justify-center rounded-full border-[1.5px] px-5 text-[15px] font-bold disabled:opacity-60 ${focusRing} ${
          pressed
            ? 'border-accent bg-accent-tint text-accent-text'
            : 'border-[#D6D3D1] bg-white text-ink'
        }`}
      >
        {pressed ? t('likes.liked') : t('likes.like')}
      </button>
      {hint && (
        <p id={hintId} className="text-start text-sm text-muted">
          {t('likes.hint')}
        </p>
      )}
      {problem === 'roomSection' && (
        <div role="alert" className="flex flex-col items-start gap-1">
          <p className={fieldError}>{t('likes.errors.roomSection')}</p>
          <Link
            to={roomSectionHref(location.pathname)}
            className={`inline-flex min-h-[44px] items-center rounded text-accent-text underline underline-offset-4 ${focusRing}`}
          >
            {t('likes.toProfile')}
          </Link>
        </div>
      )}
      {problem === 'gone' && (
        <p role="alert" className={fieldError}>
          {t('likes.errors.gone')}
        </p>
      )}
      {problem === 'rateLimited' && (
        <p role="alert" className={fieldError}>
          {t('likes.errors.rateLimited')}
        </p>
      )}
      {problem === 'failed' && (
        <p role="alert" className={fieldError}>
          {t('common.error')}
        </p>
      )}
    </div>
  );
}
