import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import he from '../../../locales/he.json';
import { publicListing } from '../../search/__tests__/fixtures';
import type { ListingPublic } from '../api';
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
    chips: () =>
      within(card.getByTestId('listing-chips'))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
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
    expect(c.factsLine().startsWith('שותף/ה אחד/ת')).toBe(true);
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

    // Fewer ages than flatmates is legal.
    c = room({ flatmates_count: 3, flatmate_ages: [27] });
    expect(c.factsLine().startsWith('3 שותפים (27)')).toBe(true);
    c.view.unmount();

    // An apartment is unchanged: its title, no pill, no flatmates, no gender chip.
    c = renderCard({});
    expect(c.title()).toBe('3 חדרים, רחוב הרצל, תל אביב');
    expect(c.card.queryByText(he.listings.card.room)).toBeNull();
    expect(c.factsLine().startsWith('קומה 2 מתוך 4')).toBe(true);
    expect(c.factsLine()).not.toContain('שותפ');
    expect(c.chips()).toEqual([he.listings.card.noElevator, he.listings.furnished.none]);
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
    expect(chips.map((li) => li.textContent)).toEqual([
      he.rooms.card.similarAge,
      'לנשים בלבד',
      he.listings.card.noElevator,
      he.listings.furnished.none,
    ]);
    expect(chips[0]).toHaveClass('bg-accent-tint', 'text-accent-text');
    view.unmount();

    // On an apartment, the birth year adds nothing.
    render(
      <MemoryRouter>
        <ListingCard listing={publicListing()} today={TODAY} seekerBirthYear={year - 28} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(he.rooms.card.similarAge)).toBeNull();
  });
});
