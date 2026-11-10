import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { ListingOut } from './api';
import { formatDate, formatIls, formatRooms } from './format';

// The focus ring of the title link, drawn around the whole card.
const linkedCard =
  'relative has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-accent';

/** The facts a card shows: a created listing, or the wizard's body before it is published. */
export type CardFacts = Pick<
  ListingOut,
  | 'listing_type'
  | 'rooms'
  | 'street'
  | 'city'
  | 'floor'
  | 'total_floors'
  | 'size_sqm'
  | 'price_ils'
  | 'available_from'
  | 'elevator'
  | 'parking_spots'
  | 'furnished'
  | 'pets_allowed'
>;

type Props = {
  listing: CardFacts;
  /** Israel's calendar day, `YYYY-MM-DD`: an entry date on or before it reads "immediate". */
  today: string;
  /** Sits at the inline end of the price row (the status badge on "my listings"). */
  badge?: ReactNode;
  /** Below the chips (the row's action and its error). */
  children?: ReactNode;
  /** Makes the title a link (search results); its hit area covers the whole card. */
  to?: string;
  /** Id of the title, so the row's actions can name the listing (`aria-describedby`). */
  titleId?: string;
};

/**
 * The wizard's preview, the "my listings" row and a search result: Listing.dc.html's title block
 * and chips.
 */
export function ListingCard({ listing, today, badge, children, to, titleId }: Props) {
  const { t } = useTranslation();

  const chips: string[] = [];
  if (listing.listing_type === 'room') chips.push(t('listings.card.room'));
  chips.push(listing.elevator ? t('listings.card.elevator') : t('listings.card.noElevator'));
  if (listing.parking_spots === 1) chips.push(t('listings.card.parkingOne'));
  else if (listing.parking_spots > 1) {
    chips.push(t('listings.card.parkingMany', { count: listing.parking_spots }));
  }
  chips.push(
    {
      none: t('listings.furnished.none'),
      partial: t('listings.furnished.partial'),
      full: t('listings.furnished.full'),
    }[listing.furnished],
  );
  if (listing.pets_allowed) chips.push(t('listings.card.pets'));

  const facts = [
    listing.total_floors === null
      ? t('listings.card.floor', { floor: listing.floor })
      : t('listings.card.floorOf', { floor: listing.floor, total: listing.total_floors }),
    `${String(listing.size_sqm)} ${t('listings.units.sqm')}`,
    listing.available_from <= today
      ? t('listings.card.immediate')
      : t('listings.card.availableFrom', { date: formatDate(listing.available_from) }),
  ];

  const title = t('listings.card.title', {
    rooms: formatRooms(listing.rooms),
    street: listing.street,
    city: listing.city,
  });

  return (
    <article
      className={`overflow-hidden rounded-2xl border border-line bg-white ${to === undefined ? '' : linkedCard}`}
    >
      <div className="flex h-[120px] items-center justify-center bg-[#DDD6CE]">
        <svg
          aria-hidden="true"
          width="40"
          height="40"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#A8A29E"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M21 16l-5-5-8 8" />
        </svg>
      </div>
      <div className="flex flex-col gap-2 px-4 pb-4 pt-[14px]">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[24px] font-extrabold tracking-[-0.3px]">
            <span>
              {formatIls(listing.price_ils)} {t('listings.units.ils')}
            </span>{' '}
            <span className="text-sm font-medium tracking-normal text-muted">
              {t('listings.units.perMonth')}
            </span>
          </p>
          {badge}
        </div>
        <h2 id={titleId} className="break-words text-lg font-bold leading-snug">
          {to === undefined ? (
            title
          ) : (
            // The pseudo-element stretches the link over the card (the artboard's card is one
            // link), so the tap target is the card while the accessible name stays the title.
            <Link
              to={to}
              className="outline-none after:absolute after:inset-0 after:content-[''] hover:underline"
            >
              {title}
            </Link>
          )}
        </h2>
        <p className="flex flex-wrap gap-x-[10px] text-sm text-muted">
          {facts.map((fact, i) => (
            <span key={fact} className="flex gap-x-[10px]">
              {i > 0 && <span aria-hidden="true">·</span>}
              <span>{fact}</span>
            </span>
          ))}
        </p>
        <ul data-testid="listing-chips" className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li
              key={chip}
              className="rounded-full border border-line bg-[#F5F5F4] px-3 py-[6px] text-[13px] font-semibold"
            >
              {chip}
            </li>
          ))}
        </ul>
        {children}
      </div>
    </article>
  );
}
