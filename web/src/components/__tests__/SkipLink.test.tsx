import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { SkipLink } from '../SkipLink';

describe('SkipLink', () => {
  it('skip_link_focuses_main', () => {
    render(
      <>
        <SkipLink />
        <main id="main" tabIndex={-1} />
      </>,
    );
    const link = screen.getByRole('link', { name: he.a11y.skipToMain });
    expect(link).toHaveAttribute('href', '#main');
    expect(link).toHaveClass('sr-only', 'focus:not-sr-only', 'focus:bg-surface');
    fireEvent.click(link);
    expect(document.activeElement).toBe(document.getElementById('main'));
  });
});
