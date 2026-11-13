import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { publicListing } from '../../search/__tests__/fixtures';
import type { ListingPublic } from '../api';
import { formatDate } from '../format';
import { ListingCard } from '../ListingCard';

const TODAY = '2026-11-11';
const MAQAF = '־';

function renderCard(overrides: Partial<ListingPublic>) {
  const listing = publicListing({ city: 'תל אביב', street: 'הרצל', rooms: 3, ...overrides });
  const view = render(
    <MemoryRouter>
      <ListingCard listing={listing} today={TODAY} to={`/listings/${listing.id}`} />
    </MemoryRouter>,
  );
  const card = within(screen.getByRole('article'));
  const heading = screen.getByRole('heading', { level: 2 });
  return {
    view,
    card,
    title: () => card.getByRole('link').textContent,
    // The facts line is the paragraph right after the title.
    factsLine: () => heading.nextElementSibling?.textContent ?? '',
    // The room chips only; `[]` when the list is absent (no chip to show).
    chips: () => {
      const list = card.queryByTestId('listing-chips');
      return list === null
        ? []
        : within(list)
            .getAllByRole('listitem')
            .map((li) => li.textContent);
    },
  };
}

const room = (overrides: Partial<ListingPublic> = {}) =>
  renderCard({
    listing_type: 'room',
    gender_preference: 'women',
    flatmates_count: 2,
    flatmate_ages: [27, 30],
    ...overrides,
  });

describe('ListingCard', () => {
  it('ac4_room_card', () => {
    // The artboard's room card: title, the photo pill (only), flatmates first, "who" chip.
    let c = room();
    expect(c.title()).toBe(`חדר ב${MAQAF}3 חדרים, רחוב הרצל, תל אביב`);
    expect(c.card.getAllByText(he.listings.card.room)).toHaveLength(1);
    expect(c.chips()).not.toContain(he.listings.card.room);
    expect(c.factsLine().startsWith('2 שותפים (27, 30)')).toBe(true);
    expect(c.chips()).toContain('לנשים בלבד');
    // No seeker birth year: no "your age" chip.
    expect(c.card.queryByText(he.rooms.card.similarAge)).toBeNull();
    c.view.unmount();

    // Men only.
    c = room({ gender_preference: 'men' });
    expect(c.chips()).toContain('לגברים בלבד');
    c.view.unmount();

    // Any: no "who" chip.
    c = room({ gender_preference: 'any' });
    expect(c.chips().some((chip) => chip?.endsWith('בלבד'))).toBe(false);
    c.view.unmount();

    // One flatmate, no ages.
    c = room({ flatmates_count: 1, flatmate_ages: [] });
    expect(c.factsLine().startsWith('אדם אחד בדירה')).toBe(true);
    c.view.unmount();

    // A visitor's or an owner's response (room privacy): no ages, no parentheses.
    c = room({ flatmates_count: 2, flatmate_ages: [] });
    expect(c.factsLine().startsWith('2 שותפים')).toBe(true);
    expect(c.factsLine()).not.toContain('(');
    c.view.unmount();

    // A room from before 0007a: no flatmates text, the floor leads.
    c = room({ flatmates_count: null, flatmate_ages: [] });
    expect(c.factsLine()).not.toContain('שותפ');
    expect(c.factsLine().startsWith('קומה 2')).toBe(true);
    c.view.unmount();

    // Fewer ages than flatmates is legal: each missing age shows as "?" (spec 0009b).
    c = room({ flatmates_count: 3, flatmate_ages: [27] });
    expect(c.factsLine().startsWith('3 שותפים (27, ?, ?)')).toBe(true);
    c.view.unmount();

    // An apartment is unchanged: its title, no pill, no flatmates, no gender chip.
    c = renderCard({});
    expect(c.title()).toBe('3 חדרים, רחוב הרצל, תל אביב');
    expect(c.card.queryByText(he.listings.card.room)).toBeNull();
    expect(c.factsLine().startsWith('קומה 2 מתוך 4')).toBe(true);
    expect(c.factsLine()).not.toContain('שותפ');
    expect(c.chips()).toEqual([]);
    expect(c.factsLine()).toContain(he.listings.card.noElevator);
    expect(c.factsLine()).toContain(he.listings.furnished.none);
  });

  it('ac3_parking_and_flatmates_forms', () => {
    // What the card shows, wherever it shows it.
    const shown = () => screen.getByRole('article').textContent;
    let c = renderCard({ parking_spots: 1 });
    expect(c.factsLine()).toContain('\u05d7\u05e0\u05d9\u05d4');
    expect(shown()).not.toContain('\u05d7\u05e0\u05d9\u05d5\u05ea');
    c.view.unmount();
    c = renderCard({ parking_spots: 2 });
    expect(shown()).toContain('2 \u05d7\u05e0\u05d9\u05d5\u05ea');
    c.view.unmount();

    c = room({ flatmates_count: 1, flatmate_ages: [] });
    expect(shown()).toContain(
      '\u05d0\u05d3\u05dd \u05d0\u05d7\u05d3 \u05d1\u05d3\u05d9\u05e8\u05d4',
    );
    c.view.unmount();
    c = room({ flatmates_count: 2, flatmate_ages: [30] });
    expect(shown()).toContain('2 \u05e9\u05d5\u05ea\u05e4\u05d9\u05dd (30, ?)');
    c.view.unmount();
    c = room({ flatmates_count: 2, flatmate_ages: [] });
    expect(shown()).toContain('2 \u05e9\u05d5\u05ea\u05e4\u05d9\u05dd');
    expect(shown()).not.toContain('2 \u05e9\u05d5\u05ea\u05e4\u05d9\u05dd (');
    c.view.unmount();
  });

  it('ac4_room_furnished_forms', () => {
    const forms = [
      ['full', '\u05de\u05e8\u05d5\u05d4\u05d8'],
      ['partial', '\u05de\u05e8\u05d5\u05d4\u05d8 \u05d7\u05dc\u05e7\u05d9\u05ea'],
      ['none', '\u05dc\u05d0 \u05de\u05e8\u05d5\u05d4\u05d8'],
    ] as const;
    for (const [furnished, text] of forms) {
      const c = room({ furnished });
      expect(c.factsLine()).toContain(text);
      c.view.unmount();
    }
    const c = renderCard({ listing_type: 'apartment', furnished: 'full' });
    expect(c.factsLine()).toContain('\u05de\u05e8\u05d5\u05d4\u05d8\u05ea');
    c.view.unmount();
  });

  it('ac5_similar_age_chip_first', () => {
    const year = new Date().getUTCFullYear();
    const listing = publicListing({
      listing_type: 'room',
      gender_preference: 'women',
      flatmates_count: 2,
      flatmate_ages: [27, 30],
    });
    const view = render(
      <MemoryRouter>
        <ListingCard listing={listing} today={TODAY} seekerBirthYear={year - 28} />
      </MemoryRouter>,
    );
    const chips = within(screen.getByTestId('listing-chips')).getAllByRole('listitem');
    expect(chips.map((li) => li.textContent)).toEqual([he.rooms.card.similarAge, 'לנשים בלבד']);
    expect(chips[0]).toHaveClass('bg-accent-soft', 'text-accent-strong');
    // The elevator and furnishing facts read in the facts line, not as chips.
    expect(screen.getByTestId('listing-facts')).toHaveTextContent(he.listings.card.noElevator);
    view.unmount();

    // On an apartment, the birth year adds nothing.
    render(
      <MemoryRouter>
        <ListingCard listing={publicListing()} today={TODAY} seekerBirthYear={year - 28} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(he.rooms.card.similarAge)).toBeNull();
  });

  it('ac4_card_anatomy', () => {
    const entry = new Date(`${TODAY}T00:00:00Z`);
    entry.setUTCDate(entry.getUTCDate() + 30);
    const available = entry.toISOString().slice(0, 10);
    const base = {
      floor: 3,
      total_floors: 5,
      size_sqm: 95,
      elevator: true,
      parking_spots: 1,
      furnished: 'partial' as const,
      pets_allowed: true,
      available_from: available,
    };
    const apartment = publicListing({ city: 'תל אביב', street: 'הרצל', rooms: 3, ...base });
    const view = render(
      <MemoryRouter>
        <ListingCard
          listing={apartment}
          today={TODAY}
          to={`/listings/${apartment.id}`}
          badge={<span data-testid="the-badge">התאמה 87%</span>}
        />
      </MemoryRouter>,
    );
    const article = screen.getByRole('article');
    // Today's stack layout is the default.
    expect(article).toHaveAttribute('data-layout', 'stack');
    expect(within(article).getAllByRole('link')).toHaveLength(1);
    const facts = screen.getByRole('heading', { level: 2 }).nextElementSibling;
    expect(facts).toBe(screen.getByTestId('listing-facts'));
    // The facts, in order, with their separators aria-hidden.
    const items = [...(facts?.querySelectorAll('span > span:not([aria-hidden])') ?? [])].map(
      (el) => el.textContent,
    );
    expect(items).toEqual([
      'קומה 3 מתוך 5',
      '95 מ״ר',
      he.listings.card.elevator,
      he.listings.card.parking_one,
      he.listings.furnished.partial,
      he.listings.card.pets,
      i18n.t('listings.card.availableFrom', { date: formatDate(available) }),
    ]);
    // No chip list on an apartment; the badge sits in the price row.
    expect(screen.queryByTestId('listing-chips')).toBeNull();
    const badge = screen.getByTestId('the-badge');
    expect(badge.parentElement).toBe(within(article).getByText(/₪/).closest('p')?.parentElement);
    view.unmount();

    // A women-only room, ages given, for a seeker born 28 years ago.
    const year = new Date().getUTCFullYear();
    const room = publicListing({
      listing_type: 'room',
      gender_preference: 'women',
      flatmates_count: 2,
      flatmate_ages: [27, 30],
    });
    const rooms = render(
      <MemoryRouter>
        <ListingCard
          listing={room}
          today={TODAY}
          to={`/listings/${room.id}`}
          seekerBirthYear={year - 28}
          layout="row"
        />
      </MemoryRouter>,
    );
    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('data-layout', 'row');
    expect(within(card).getAllByRole('link')).toHaveLength(1);
    expect(screen.getByTestId('listing-facts').textContent?.startsWith('2 שותפים (27, 30)')).toBe(
      true,
    );
    const chips = within(screen.getByTestId('listing-chips')).getAllByRole('listitem');
    expect(chips.map((li) => li.textContent)).toEqual([he.rooms.card.similarAge, 'לנשים בלבד']);
    expect(chips[0]).toHaveClass('bg-accent-soft', 'text-accent-strong');
    expect(chips[1]).toHaveClass('bg-surface-subtle', 'text-ink');
    // The room pill is in the photo box (the neutral tag, at the top inline-start corner).
    const pill = within(card).getByText(he.listings.card.room);
    expect(pill).toHaveClass('absolute', 'start-2', 'top-2', 'bg-surface-subtle');
    expect(pill.parentElement).toHaveClass('aspect-[16/10]');
    rooms.unmount();

    // A visitor's response has no ages: none anywhere on the card.
    const visitor = publicListing({
      listing_type: 'room',
      gender_preference: 'women',
      flatmates_count: 2,
      flatmate_ages: [],
    });
    render(
      <MemoryRouter>
        <ListingCard listing={visitor} today={TODAY} to={`/listings/${visitor.id}`} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('article').textContent).toContain('2 שותפים');
    expect(screen.getByRole('article').textContent).not.toContain('(');
  });

  it('ac6_compact_layout', () => {
    // The search map's docked card (spec 0009w): the row anatomy with no breakpoint, a 96px photo
    // box at the inline start, and the price row clear of the close button at the top end.
    const room = publicListing({
      listing_type: 'room',
      gender_preference: 'women',
      flatmates_count: 2,
      flatmate_ages: [],
      price_ils: 3400,
    });
    render(
      <MemoryRouter>
        <ListingCard
          listing={room}
          today={TODAY}
          to={`/listings/${room.id}`}
          layout="compact"
          badge={<span data-testid="the-badge">התאמה 82%</span>}
        />
      </MemoryRouter>,
    );
    const card = screen.getByRole('article');
    expect(card).toHaveAttribute('data-layout', 'compact');
    // The photo box: first in the row, 16:10, w-24, with the same placeholder and the room pill.
    const pill = within(card).getByText(he.listings.card.room);
    const photo = pill.parentElement as HTMLElement;
    expect(photo).toHaveClass('aspect-[16/10]', 'w-24', 'shrink-0');
    expect(photo.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const row = photo.parentElement as HTMLElement;
    expect(row.firstElementChild).toBe(photo);
    expect(row).toHaveClass('flex-row');
    // The row anatomy at every width: no breakpoint-only class on the row or the photo box.
    for (const element of [row, photo]) {
      expect([...element.classList].filter((name) => name.startsWith('lg:'))).toEqual([]);
    }
    // The price row (the badge at its end) gets `pe-12`; title link and facts as in `row`.
    const badge = screen.getByTestId('the-badge');
    const priceRow = badge.parentElement as HTMLElement;
    expect(priceRow).toHaveClass('pe-12');
    expect(within(priceRow).getByText(/3,400/)).toBeVisible();
    expect(within(card).getAllByRole('link')).toHaveLength(1);
    expect(within(card).getByRole('link')).toHaveAttribute('href', `/listings/${room.id}`);
    expect(screen.getByTestId('listing-facts').textContent?.startsWith('2 שותפים')).toBe(true);
    // The title's first line can reach the close button's 44 px box: its end is kept clear too.
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('pe-12');
    expect(screen.getByRole('heading', { level: 2 }).nextElementSibling).toBe(
      screen.getByTestId('listing-facts'),
    );
  });

  it('ac3_heading_level_none', () => {
    // `titleAs="p"` (0009a's "none"; the one heading prop, shared with 0009c): no heading at all.
    const listing = publicListing({ city: 'תל אביב', street: 'הרצל', rooms: 3 });
    const view = render(<ListingCard listing={listing} today={TODAY} titleAs="p" />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText(/הרצל/).tagName).toBe('P');
    view.unmount();

    // The default is still an <h2>.
    render(<ListingCard listing={listing} today={TODAY} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('הרצל');
  });

  it('ac14_own_tag', () => {
    // Spec 0010b: the caller's own listing carries a neutral tag as the first chip.
    const own = renderCard({
      listing_type: 'room',
      flatmates_count: 2,
      gender_preference: 'women',
      is_mine: true,
    });
    expect(own.chips()).toEqual([he.listings.card.mineRoom, 'לנשים בלבד']);
    expect(own.card.getByText(he.listings.card.mineRoom)).toHaveClass('bg-surface-subtle');
    own.view.unmount();

    let { view, chips } = renderCard({ is_mine: true });

    expect(chips()).toEqual([he.listings.card.mineApartment]);
    view.unmount();

    // Someone else's listing, or one with no `is_mine` (my listings): no tag.
    for (const overrides of [
      { is_mine: false },
      { listing_type: 'room', flatmates_count: 2, is_mine: false },
    ] as const) {
      ({ view, chips } = renderCard(overrides));
      expect(chips()).not.toContain(he.listings.card.mineRoom);
      expect(chips()).not.toContain(he.listings.card.mineApartment);
      view.unmount();
    }
  });
});
