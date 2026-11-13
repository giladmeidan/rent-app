import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Card } from '../../components/Card';
import { Tag, type TagTone } from '../../components/Tag';
import { flatmatesNearAge } from '../rooms/age';
import { flatmatesText, genderPreferenceLabel } from '../rooms/flatmates';
import type { ListingOut } from './api';
import { cardTitle } from './cardTitle';
import { entryFact, floorFact, sizeFact } from './facts';
import { formatIls } from './format';
import { furnishedLabel } from './furnished';

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

type Chip = { text: string; tone: TagTone };

const titleClass = 'break-words text-body font-medium';

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
  /** `stack` (default): the vertical card. `row`: the stacked card below `lg`, and from `lg` up the
   * row card of SearchDesktop.dc.html (photo at the inline start); chosen by CSS only. `compact`:
   * the row anatomy at every width with a smaller photo, and room at the price row's end for a
   * close button (the search map's docked card, spec 0009w). */
  layout?: 'stack' | 'row' | 'compact';
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
  layout = 'stack',
}: Props) {
  const { t } = useTranslation();
  const isRoom = listing.listing_type === 'room';

  // Only the room chips; every other fact reads in the facts line.
  const chips: Chip[] = [];
  if (isRoom) {
    if (flatmatesNearAge(seekerBirthYear, listing.flatmate_ages ?? [])) {
      chips.push({ text: t('rooms.card.similarAge'), tone: 'accent' });
    }
    const who = listing.gender_preference;
    if (who === 'women' || who === 'men') {
      chips.push({
        text: t('rooms.card.forGender', { who: genderPreferenceLabel(t, who) }),
        tone: 'neutral',
      });
    }
  }

  const flatmates = isRoom ? flatmatesText(t, listing) : null;
  const facts = [
    ...(flatmates === null ? [] : [flatmates]),
    floorFact(listing, t),
    sizeFact(listing, t),
    listing.elevator ? t('listings.card.elevator') : t('listings.card.noElevator'),
    ...(listing.parking_spots > 0
      ? [t('listings.card.parking', { count: listing.parking_spots })]
      : []),
    furnishedLabel(t, listing.furnished, listing.listing_type),
    ...(listing.pets_allowed ? [t('listings.card.pets')] : []),
    entryFact(listing, today, t),
  ];

  const title = cardTitle(t, listing);

  const row = layout === 'row';
  const compact = layout === 'compact';
  const outerClass = compact
    ? 'flex flex-row gap-3 p-3'
    : row
      ? 'flex flex-col lg:flex-row lg:gap-4 lg:p-3'
      : 'flex flex-col';
  const photoClass = compact
    ? 'w-24 shrink-0 self-start rounded-md'
    : `rounded-t-lg ${row ? 'lg:w-44 lg:shrink-0 lg:self-start lg:rounded-md' : ''}`;
  const bodyClass = compact ? 'p-0' : row ? 'p-3 lg:p-0' : 'p-3';

  return (
    <Card
      as="article"
      padding="none"
      interactive={to !== undefined}
      data-layout={layout}
      className="overflow-hidden"
    >
      <div className={outerClass}>
        {/* The photo box: the brand's 16:10 crop (no aspect token), 176px wide in the row layout
            and 96px in the compact one. */}
        <div
          className={`relative flex aspect-[16/10] items-center justify-center bg-surface-subtle ${photoClass}`}
        >
          <svg
            aria-hidden="true"
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            className="text-ink-muted"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="M21 16l-5-5-8 8" />
          </svg>
          {isRoom && (
            <Tag size="sm" className="absolute start-2 top-2">
              {t('listings.card.room')}
            </Tag>
          )}
        </div>
        <div className={`flex min-w-0 flex-1 flex-col gap-2 ${bodyClass}`}>
          {/* Compact: the badge clears the close button its container puts at the top end. */}
          <div className={`flex items-center justify-between gap-3 ${compact ? 'pe-12' : ''}`}>
            <p className="text-h3 font-bold tracking-tight">
              <span>
                {formatIls(listing.price_ils)} {t('listings.units.ils')}
              </span>{' '}
              <span className="text-body-sm font-normal tracking-normal text-ink-muted">
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
          <p
            data-testid="listing-facts"
            className="flex flex-wrap gap-x-2.5 text-body-sm text-ink-muted"
          >
            {facts.map((fact, i) => (
              <span key={fact} className="flex gap-x-2.5">
                {i > 0 && <span aria-hidden="true">·</span>}
                <span>{fact}</span>
              </span>
            ))}
          </p>
          {chips.length > 0 && (
            <ul data-testid="listing-chips" className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <Tag key={chip.text} as="li" size="sm" tone={chip.tone}>
                  {chip.text}
                </Tag>
              ))}
            </ul>
          )}
          {children !== undefined &&
            children !== null &&
            (row || compact ? <div className="mt-auto">{children}</div> : children)}
        </div>
      </div>
    </Card>
  );
}
