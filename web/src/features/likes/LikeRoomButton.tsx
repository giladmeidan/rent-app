import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';

import { Button } from '../../components/Button';
import { hasStatus } from '../applications/api';
import { ApiError } from '../listings/api';
import { roomSectionHref } from '../profile/links';
import type { LikeStateOut } from './api';
import { likeProblem, useLikeRoom, useUnlikeRoom } from './useLikeRoom';

const fieldError = 'text-body-sm font-semibold text-danger';

type Props = {
  listingId: string;
  like: LikeStateOut;
  /** Called with the application's id when this like made the pair mutual. */
  onMutual: (applicationId: string) => void;
  /** The listing page's one-line hint under an idle button. */
  showHint?: boolean;
  /** Called after a successful unlike (spec 0009t: "my likes" then moves focus). */
  onUnliked?: () => void;
  /** Called after a successful like that did not make the pair mutual. */
  onLikedNotMutual?: () => void;
  /**
   * The card is leaving the list after a failed like or unlike (spec 0009g): a 404 (`'gone'`) or a
   * 409 `already_applied` (`'alreadyApplied'`). When passed, the page says why and this button
   * shows no `gone` alert of its own.
   */
  onGone?: (reason: 'gone' | 'alreadyApplied') => void;
};

/** Why the card leaves the list after `error`, or null when it stays. */
function goneReason(error: unknown): 'gone' | 'alreadyApplied' | null {
  if (hasStatus(error, 404)) return 'gone';
  if (error instanceof ApiError && error.status === 409 && error.detail === 'already_applied') {
    return 'alreadyApplied';
  }
  return null;
}

/**
 * The room like toggle (`aria-pressed`), with the "the lister liked you" line above it. It is
 * disabled while its request runs. A like never refetches the listing (`useLikeRoom`).
 */
export function LikeRoomButton({
  listingId,
  like,
  onMutual,
  showHint = false,
  onUnliked,
  onLikedNotMutual,
  onGone,
}: Props) {
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
    const onError = (error: unknown) => {
      const reason = goneReason(error);
      if (reason !== null) onGone?.(reason);
    };
    if (pressed) {
      liking.reset();
      unliking.mutate(undefined, {
        onSettled: settled,
        onSuccess: () => onUnliked?.(),
        onError,
      });
    } else {
      unliking.reset();
      liking.mutate(undefined, {
        onSettled: settled,
        onSuccess: (result) => {
          if (result.application_id !== null) onMutual(result.application_id);
          else onLikedNotMutual?.();
        },
        onError,
      });
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {like.liked_me && !pressed && (
        <p className="text-start text-body font-semibold text-accent-strong">
          {t('likes.likedYouLine')}
        </p>
      )}
      {/* `disabled` while the request runs, not the kit's `busy`: the tests pin the attribute. */}
      <Button
        variant={pressed ? 'soft' : 'secondary'}
        aria-pressed={pressed}
        disabled={pending}
        aria-busy={pending}
        aria-describedby={hint ? hintId : undefined}
        onClick={onClick}
      >
        {pressed ? t('likes.liked') : t('likes.like')}
      </Button>
      {hint && (
        <p id={hintId} className="text-start text-body-sm text-ink-muted">
          {t('likes.hint')}
        </p>
      )}
      {problem === 'roomSection' && (
        <div role="alert" className="flex flex-col items-start gap-1">
          <p className={fieldError}>{t('likes.errors.roomSection')}</p>
          <Button variant="ghost" to={roomSectionHref(location.pathname)}>
            {t('likes.toProfile')}
          </Button>
        </div>
      )}
      {problem === 'gone' && onGone === undefined && (
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
