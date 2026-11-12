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
    expect(c.chips()).toEqual([he.listings.card.noElevator, he.listings.furnished.none]);
  });

  it('ac3_parking_and_flatmates_forms', () => {
    // What the card shows, wherever it shows it.
    const shown = () => screen.getByRole('article').textContent;
    let c = renderCard({ parking_spots: 1 });
    expect(c.chips()).toContain('\u05d7\u05e0\u05d9\u05d4');
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
      expect(c.chips()).toContain(text);
      c.view.unmount();
    }
    const c = renderCard({ listing_type: 'apartment', furnished: 'full' });
    expect(c.chips()).toContain('\u05de\u05e8\u05d5\u05d4\u05d8\u05ea');
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
    expect(chips.map((li) => li.textContent)).toEqual([
      he.rooms.card.similarAge,
      'לנשים בלבד',
      he.listings.card.noElevator,
      he.listings.furnishedRoom.none,
    ]);
    expect(chips[0]).toHaveClass('bg-accent-soft', 'text-accent-strong');
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
