import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import { cx } from '../components/cx';
import { focusRing } from '../components/focusRing';
import { useMe } from '../features/auth/useMe';
import { homeFor } from '../features/landing/home';
import { setSide, useSide, type Side } from './side';

/**
 * The header's דירות / שוק השותפים switch (spec 0010a), signed in and out: two links in a pill
 * pair. The active side's link is `aria-current="page"` on its own home and `"true"` elsewhere on
 * that side. Below `md` it fills its own header row in two equal halves; from `md` it sits inline.
 */
export function SideSwitch() {
  const { t } = useTranslation();
  const side = useSide();
  const me = useMe();
  const { pathname } = useLocation();
  // While `/me` loads, or for a visitor, the apartments home is the search.
  const apartmentsHome = me.data ? homeFor(me.data.role) : '/search';
  const items: { side: Side; to: string; label: string }[] = [
    { side: 'apartments', to: apartmentsHome, label: t('side.apartments') },
    { side: 'market', to: '/market', label: t('side.market') },
  ];

  return (
    <nav
      aria-label={t('side.label')}
      className="flex w-full rounded-full border border-border bg-surface md:inline-flex md:w-auto"
    >
      {items.map((item) => {
        const active = item.side === side;
        return (
          <Link
            key={item.side}
            to={item.to}
            aria-current={active ? (pathname === item.to ? 'page' : 'true') : undefined}
            onClick={() => setSide(item.side)}
            className={cx(
              'flex min-h-tap flex-1 items-center justify-center whitespace-nowrap rounded-full px-4 text-label md:flex-none',
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
