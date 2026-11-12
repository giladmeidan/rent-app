import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useMyLikes } from './useMyLikes';

const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * The seeker's header link to `/me/likes`, with an amber pill counting the rooms that liked them
 * (built as `ChatNavLink`'s: the number is hidden from assistive tech, the sentence completes the
 * link's name). A pending or failed list shows no pill and never blocks the header.
 */
export function LikesNavLink() {
  const { t } = useTranslation();
  const likes = useMyLikes();
  const count = likes.data?.liked_me.length ?? 0;

  return (
    <Link
      to="/me/likes"
      className={`inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-full px-[10px] text-[15px] font-semibold text-accent-strong ${focusRing}`}
    >
      {t('header.likes')}
      {count > 0 && (
        <>
          <span
            aria-hidden="true"
            className="min-w-[22px] rounded-full bg-accent-soft px-[6px] py-[1px] text-center text-[12px] font-bold text-accent-strong"
          >
            {count}
          </span>{' '}
          <span className="sr-only">{t('likes.badgeLabel', { count })}</span>
        </>
      )}
    </Link>
  );
}
