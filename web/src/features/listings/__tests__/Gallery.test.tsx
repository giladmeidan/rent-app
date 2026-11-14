import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Gallery } from '../Gallery';

const photo = (n: number) => ({
  id: `p${String(n)}`,
  small_url: `https://media.test/${String(n)}-s.webp`,
  large_url: `https://media.test/${String(n)}-l.webp`,
});

describe('Gallery', () => {
  it('main_image_error_shows_the_placeholder', () => {
    const view = render(<Gallery photos={[photo(1), photo(2)]} title="title" />);
    const main = view.container.querySelector('img[src$="1-l.webp"]') as HTMLImageElement;
    fireEvent.error(main);
    expect(view.container.querySelector('img[src$="1-l.webp"]')).toBeNull();
    expect(view.container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    // The thumbnails stay: another photo is shown by pressing it.
    fireEvent.click(screen.getAllByRole('button')[1] as HTMLElement);
    expect(view.container.querySelector('img[src$="2-l.webp"]')).not.toBeNull();
  });

  it('the_shown_index_is_clamped_when_photos_shrink', () => {
    const view = render(<Gallery photos={[photo(1), photo(2), photo(3)]} title="title" />);
    fireEvent.click(screen.getAllByRole('button')[2] as HTMLElement);
    expect(view.container.querySelector('img[src$="3-l.webp"]')).not.toBeNull();
    // A refetch after a delete: two photos left; the last one is shown.
    view.rerender(<Gallery photos={[photo(1), photo(2)]} title="title" />);
    expect(view.container.querySelector('img[src$="2-l.webp"]')).not.toBeNull();
    expect(screen.getAllByRole('button')[1]).toHaveAttribute('aria-pressed', 'true');
    // Down to one photo: no thumbnails.
    view.rerender(<Gallery photos={[photo(1)]} title="title" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(view.container.querySelector('img[src$="1-l.webp"]')).not.toBeNull();
  });
});
