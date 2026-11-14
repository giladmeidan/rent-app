import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { cx } from '../../components/cx';
import { focusRing } from '../../components/focusRing';
import { ListingCard } from '../listings/ListingCard';
import { searchListings } from '../search/api';
import { Chevron } from './Icon';
import { SECTION } from './links';

/** The section shows only with this many live apartments (spec 0009z Q1). */
const COUNT = 3;

/**
 * Main.html §3, "עלו לאחרונה": the three newest live apartments, as the search page's cards. Its
 * own query (not `useSearch`'s infinite one), so it never shares the search page's cache. While
 * pending, on an error or with fewer than three, the section is absent: no skeleton, no error.
 * Below `lg` one swipe row that scrolls inside itself; from `lg` three columns.
 */
export function LatestListings({ today }: { today: string }) {
  const { t } = useTranslation();
  const latest = useQuery({
    queryKey: ['landing', 'latest'],
    queryFn: () =>
      searchListings({ listing_type: 'apartment', sort: 'newest' }, 0, { limit: COUNT }),
  });
  const items = latest.data?.items ?? [];
  if (items.length < COUNT) return null;

  return (
    <section aria-labelledby="landing-latest" className={SECTION}>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="landing-latest" className="font-display text-h2">
            {t('landing.latest.title')}
          </h2>
          <p className="mt-1 text-body text-ink-muted">{t('landing.latest.subtitle')}</p>
        </div>
        <Link
          to="/search"
          className={cx(
            'inline-flex min-h-tap shrink-0 items-center gap-1 rounded-sm text-label text-accent hover:text-accent-strong',
            focusRing,
          )}
        >
          {t('landing.latest.all')}
          <Chevron size={16} />
        </Link>
      </div>
      {/* p-0.5 keeps the cards' focus ring inside the row's scroll box. */}
      <ul className="grid snap-x snap-mandatory auto-cols-[82%] grid-flow-col gap-3 overflow-x-auto p-0.5 pb-1 lg:auto-cols-auto lg:grid-flow-row lg:grid-cols-3 lg:overflow-visible">
        {items.slice(0, COUNT).map((listing) => (
          <li key={listing.id} className="landing-reveal snap-start">
            <ListingCard
              listing={listing}
              today={today}
              to={`/listings/${listing.id}`}
              coverUrl={listing.cover?.small_url}
              titleAs="h3"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
