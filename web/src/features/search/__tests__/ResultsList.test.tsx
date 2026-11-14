import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ListingSearchOut } from '../api';
import { ResultsList } from '../ResultsList';
import { page, publicListing } from './fixtures';

/** The slice of a loaded `useSearch` that the list reads. */
function loaded(result: ListingSearchOut) {
  const data: InfiniteData<ListingSearchOut> = { pages: [result], pageParams: [0] };
  return {
    data,
    isPending: false,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    hasNextPage: false,
  } as unknown as UseInfiniteQueryResult<InfiniteData<ListingSearchOut>>;
}

describe('ResultsList', () => {
  it('ac2_cover', () => {
    const withCover = publicListing({
      cover: { id: 'p1', small_url: 'https://media.test/a-s.webp', large_url: 'x-l.webp' },
    });
    const without = publicListing({ cover: null });
    render(
      <MemoryRouter>
        <ResultsList
          search={loaded(page([withCover, without]))}
          hasFilters={false}
          onClear={() => undefined}
          profile={undefined}
        />
      </MemoryRouter>,
    );
    const [first, second] = screen.getAllByRole('article');
    // The cover's small address, decorative; and the placeholder without one.
    const img = (first as HTMLElement).querySelector('img');
    expect(img).toHaveAttribute('src', 'https://media.test/a-s.webp');
    expect(img).toHaveAttribute('alt', '');
    expect((second as HTMLElement).querySelector('img')).toBeNull();
    expect((second as HTMLElement).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});
