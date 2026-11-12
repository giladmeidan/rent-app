import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { PageContainer } from '../PageContainer';

const GUTTERS = ['mx-auto', 'box-content', 'px-4', 'md:px-6', 'lg:px-8'];

describe('PageContainer', () => {
  it('ac5_widths', () => {
    const widths = { narrow: 'max-w-narrow', default: 'max-w-page', wide: 'max-w-wide' } as const;
    for (const [width, cls] of Object.entries(widths)) {
      const { container, unmount } = render(
        <PageContainer width={width as keyof typeof widths}>{he.app.tagline}</PageContainer>,
      );
      const box = container.firstElementChild as HTMLElement;
      expect(box.tagName).toBe('DIV');
      expect(box).toHaveClass(cls, ...GUTTERS);
      expect(box).not.toHaveClass('w-full');
      for (const other of Object.values(widths)) {
        if (other !== cls) expect(box).not.toHaveClass(other);
      }
      unmount();
    }

    // The default width, `as`, layout classes and HTML attributes.
    for (const as of ['section', 'article'] as const) {
      const { container, unmount } = render(
        <PageContainer as={as} className="py-8" aria-label={he.app.title}>
          {he.app.tagline}
        </PageContainer>,
      );
      const box = container.firstElementChild as HTMLElement;
      expect(box.tagName).toBe(as.toUpperCase());
      expect(box).toHaveClass('max-w-page', 'py-8', ...GUTTERS);
      expect(box).toHaveAttribute('aria-label', he.app.title);
      unmount();
    }
  });
});
