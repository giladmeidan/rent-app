import { useTranslation } from 'react-i18next';

import { NavIcon, NavTab } from '../../components/NavTab';
import { useMyLikes } from './useMyLikes';

/**
 * The seeker's "לייקים" tab, to `/me/likes`, with a count of the rooms that liked them (built as
 * `ChatNavLink`'s: the number is hidden from assistive tech, the sentence completes the tab's
 * name). A pending or failed list shows no count and never blocks the header.
 */
export function LikesNavLink() {
  const { t } = useTranslation();
  const likes = useMyLikes();
  const count = likes.data?.liked_me.length ?? 0;

  return (
    <NavTab
      to="/me/likes"
      icon={
        <NavIcon>
          <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />
        </NavIcon>
      }
      label={t('header.likes')}
      count={count}
      countLabel={t('likes.badgeLabel', { count })}
    />
  );
}
