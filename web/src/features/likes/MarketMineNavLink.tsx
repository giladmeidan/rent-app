import { useTranslation } from 'react-i18next';

import { NavIcon, NavTab } from '../../components/NavTab';
import { useMyLikes } from './useMyLikes';

/**
 * The market's "הפעילות שלי" tab, with a count of the rooms that invited the caller (spec 0010m;
 * built as `ChatNavLink`'s: the number is hidden from assistive tech, the sentence completes the
 * tab's name). With an invite the tab opens the room applications, where the invites are; without,
 * it opens the tab as before. A pending or failed list shows no count and never blocks the header.
 */
export function MarketMineNavLink() {
  const { t } = useTranslation();
  const likes = useMyLikes();
  const count = likes.data?.liked_me.length ?? 0;

  return (
    <NavTab
      to={count > 0 ? '/market/mine?tab=applications' : '/market/mine'}
      icon={
        <NavIcon>
          <path d="M3 11l9-8 9 8" />
          <path d="M5 10v10h14V10" />
        </NavIcon>
      }
      label={t('nav.mine')}
      count={count}
      countLabel={t('market.mine.invitesBadge', { count })}
    />
  );
}
