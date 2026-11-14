import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { cx } from '../../components/cx';
import { focusRing } from '../../components/focusRing';
import { useMe } from '../auth/useMe';

export type MarketView = 'rooms' | 'people';

const PEOPLE_PATH = '/market/people';

/**
 * The inner חדרים / אנשים switch of שוק השותפים (spec 0010i): two links in the pill look of the
 * header's side switch, `aria-current="page"` on the current view. A visitor's אנשים goes through
 * login and returns to the people tab. While `/me` loads, the link is the page itself
 * (`RequireUser` sends a visitor to login from there).
 */
export function MarketViewSwitch({ current }: { current: MarketView }) {
  const { t } = useTranslation();
  const me = useMe();
  const signedOut = me.data === null;
  const items: { view: MarketView; to: string; label: string }[] = [
    { view: 'rooms', to: '/market', label: t('market.view.rooms') },
    {
      view: 'people',
      to: signedOut ? `/login?next=${encodeURIComponent(PEOPLE_PATH)}` : PEOPLE_PATH,
      label: t('market.view.people'),
    },
  ];
  return (
    <nav
      aria-label={t('market.view.label')}
      className="inline-flex self-start rounded-full border border-border bg-surface"
    >
      {items.map((item) => {
        const active = item.view === current;
        return (
          <Link
            key={item.view}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'flex min-h-tap items-center justify-center whitespace-nowrap rounded-full px-4 text-label',
              active
                ? 'bg-accent-soft font-semibold text-accent-strong'
                : 'text-ink hover:text-accent',
              focusRing,
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
