import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { Loading } from '../Loading';
import { Skeleton } from '../Skeleton';

describe('Loading', () => {
  it('loading_is_a_busy_region_that_says_so', () => {
    const { container } = render(
      <Loading>
        <Skeleton />
      </Loading>,
    );
    const region = container.firstElementChild;
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(he.common.loading)).toHaveClass('sr-only');
    expect(region?.querySelector('[data-testid="skeleton"]')).not.toBeNull();
  });
});
