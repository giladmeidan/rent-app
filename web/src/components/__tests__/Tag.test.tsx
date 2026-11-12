import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { Tag } from '../Tag';

const classesOf = (element: Element) => element.className.split(' ');

describe('Tag', () => {
  it('ac3_tag', () => {
    const tones = {
      neutral: ['border', 'border-border', 'bg-surface-subtle', 'text-ink'],
      accent: ['bg-accent-soft', 'text-accent-strong'],
      warning: ['bg-surface-subtle', 'text-warning'],
      inverse: ['bg-ink', 'text-on-ink'],
    } as const;
    const sizes = {
      sm: ['px-2.5', 'py-1', 'text-caption'],
      md: ['px-3', 'py-1.5', 'text-label'],
    } as const;
    for (const [tone, toneClasses] of Object.entries(tones)) {
      for (const [size, sizeClasses] of Object.entries(sizes)) {
        const { unmount } = render(
          <Tag tone={tone as keyof typeof tones} size={size as keyof typeof sizes}>
            {he.listings.card.elevator}
          </Tag>,
        );
        const tag = screen.getByText(he.listings.card.elevator);
        expect(tag.tagName).toBe('SPAN');
        expect(classesOf(tag)).toEqual(
          expect.arrayContaining([
            'inline-flex',
            'items-center',
            'gap-1',
            'rounded-full',
            ...toneClasses,
            ...sizeClasses,
          ]),
        );
        unmount();
      }
    }

    // Defaults are neutral / md; `as="li"` renders a list item, with an aria-hidden icon.
    render(
      <ul>
        <Tag as="li" icon={<svg data-testid="icon" />}>
          {he.listings.card.pets}
        </Tag>
      </ul>,
    );
    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent(he.listings.card.pets);
    expect(classesOf(item)).toEqual(expect.arrayContaining([...tones.neutral, ...sizes.md]));
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('passes_html_attributes', () => {
    render(
      <Tag tone="accent" data-testid="mutual" aria-label="x" id="t1">
        {he.listings.card.pets}
      </Tag>,
    );
    const tag = screen.getByTestId('mutual');
    expect(tag).toHaveAttribute('id', 't1');
    expect(tag).toHaveAttribute('aria-label', 'x');
    expect(classesOf(tag)).toContain('bg-accent-soft');
  });
});
