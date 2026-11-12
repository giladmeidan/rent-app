import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { flatmatesNearAge } from '../rooms/age';
import { flatmatesText, genderPreferenceLabel } from '../rooms/flatmates';
import type { ListingOut } from './api';
import { cardTitle } from './cardTitle';
import { formatDate, formatIls } from './format';
import { furnishedLabel } from './furnished';

// The focus ring of the title link, drawn around the whole card.
const linkedCard =
  'relative has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-accent';

/** The facts a card shows: a created listing, or the wizard's body before it is published (which
 * has no room fields until 0007e, so they are optional). */
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
> &
  Partial<Pick<ListingOut, 'gender_preference' | 'flatmates_count' | 'flatmate_ages'>>;

type Chip = { text: string; tone: 'accent' | 'plain' };

const chipClass = {
  // The artboard's teal chip ("שותפים בגילך").
  accent:
    'rounded-full border border-accent-tint bg-accent-tint px-3 py-[6px] text-[13px] font-semibold text-accent-text',
  plain: 'rounded-full border border-line bg-[#F5F5F4] px-3 py-[6px] text-[13px] font-semibold',
} as const;

const titleClass = 'break-words text-lg font-bold leading-snug';

/** The card title as a literal element switch, so each element is a static JSX tag. */
function Title({
  as,
  id,
  children,
}: {
  as: 'h2' | 'h3' | 'p';
  id: string | undefined;
  children: ReactNode;
}) {
  if (as === 'h3') {
    return (
      <h3 id={id} className={titleClass}>
        {children}
      </h3>
    );
  }
  if (as === 'p') {
    return (
      <p id={id} className={titleClass}>
        {children}
      </p>
    );
  }
  return (
    <h2 id={id} className={titleClass}>
      {children}
    </h2>
  );
}

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
  /** The seeker's birth year (their profile's room section): a room whose every listed flatmate is
   * near that age gets "שותפים בגילך". `undefined` / `null`: no such chip. */
  seekerBirthYear?: number | null | undefined;
  /** The title's element, for the page's heading order: `h3` under a section `<h2>`, `p` where
   * the card is not a section of its own. Default `h2`. */
  titleAs?: 'h2' | 'h3' | 'p';
};

/**
 * The wizard's preview, the "my listings" row and a search result: Listing.dc.html's title block
 * and chips. A room (SearchDesktop.dc.html's room card) adds the photo pill, its flatmates first on
 * the facts line, and the "your age" and "who it is for" chips; an owner sees the same anatomy.
 */
export function ListingCard({
  listing,
  today,
  badge,
  children,
  to,
  titleId,
  seekerBirthYear,
  titleAs = 'h2',
}: Props) {
  const { t } = useTranslation();
  const isRoom = listing.listing_type === 'room';

  const chips: Chip[] = [];
  const plain = (text: string) => chips.push({ text, tone: 'plain' });
  if (isRoom) {
    if (flatmatesNearAge(seekerBirthYear, listing.flatmate_ages ?? [])) {
      chips.push({ text: t('rooms.card.similarAge'), tone: 'accent' });
    }
    const who = listing.gender_preference;
    if (who === 'women' || who === 'men') {
      plain(t('rooms.card.forGender', { who: genderPreferenceLabel(t, who) }));
    }
  }
  plain(listing.elevator ? t('listings.card.elevator') : t('listings.card.noElevator'));
  if (listing.parking_spots > 0) {
    plain(t('listings.card.parking', { count: listing.parking_spots }));
  }
  plain(furnishedLabel(t, listing.furnished, listing.listing_type));
  if (listing.pets_allowed) plain(t('listings.card.pets'));

  const flatmates = isRoom ? flatmatesText(t, listing) : null;
  const facts = [
    ...(flatmates === null ? [] : [flatmates]),
    listing.total_floors === null
      ? t('listings.card.floor', { floor: listing.floor })
      : t('listings.card.floorOf', { floor: listing.floor, total: listing.total_floors }),
    `${String(listing.size_sqm)} ${t('listings.units.sqm')}`,
    listing.available_from <= today
      ? t('listings.card.immediate')
      : t('listings.card.availableFrom', { date: formatDate(listing.available_from) }),
  ];

  const title = cardTitle(t, listing);

  return (
    <article
      className={`overflow-hidden rounded-2xl border border-line bg-white ${to === undefined ? '' : linkedCard}`}
    >
      <div className="relative flex h-[120px] items-center justify-center bg-[#DDD6CE]">
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
        {isRoom && (
          // The artboard's `right: 8px`: inline-start in RTL.
          <span className="absolute bottom-2 start-2 rounded-full bg-[rgba(28,25,23,0.78)] px-2 py-[3px] text-[11px] font-semibold text-white">
            {t('listings.card.room')}
          </span>
        )}
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
        <Title as={titleAs} id={titleId}>
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
        </Title>
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
            <li key={chip.text} className={chipClass[chip.tone]}>
              {chip.text}
            </li>
          ))}
        </ul>
        {children}
      </div>
    </article>
  );
}
