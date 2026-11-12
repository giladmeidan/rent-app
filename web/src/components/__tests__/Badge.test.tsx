import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import i18n from '../../app/i18n';
import he from '../../locales/he.json';
import { Badge } from '../Badge';

const classesOf = (element: Element) => element.className.split(' ');

describe('Badge', () => {
  it('ac3_badge', () => {
    const tones = {
      accent: ['bg-accent-soft', 'text-accent-strong'],
      neutral: ['bg-surface-subtle', 'text-ink-muted'],
      solid: ['min-w-5', 'bg-accent', 'text-on-ink', 'tabular-nums'],
      inverse: ['bg-ink', 'text-on-ink'],
      warning: ['bg-surface-subtle', 'text-warning'],
    } as const;
    const sizes = {
      sm: ['px-2', 'py-0.5', 'text-caption'],
      md: ['px-2.5', 'py-1', 'text-label'],
    } as const;
    for (const [tone, toneClasses] of Object.entries(tones)) {
      for (const [size, sizeClasses] of Object.entries(sizes)) {
        const { unmount } = render(
          <Badge tone={tone as keyof typeof tones} size={size as keyof typeof sizes}>
            {he.chat.list.new}
          </Badge>,
        );
        const badge = screen.getByText(he.chat.list.new);
        expect(classesOf(badge)).toEqual(
          expect.arrayContaining([
            'inline-flex',
            'items-center',
            'justify-center',
            'whitespace-nowrap',
            'rounded-full',
            ...toneClasses,
            ...sizeClasses,
          ]),
        );
        unmount();
      }
    }

    // Defaults: accent / sm.
    const plain = render(<Badge>{he.chat.list.new}</Badge>);
    expect(classesOf(screen.getByText(he.chat.list.new))).toEqual(
      expect.arrayContaining([...tones.accent, ...sizes.sm]),
    );
    plain.unmount();

    // srLabel: sr-only text, the visible children aria-hidden.
    const label = i18n.t('chat.list.unread', { count: 3 });
    render(
      <Badge tone="solid" srLabel={label}>
        {3}
      </Badge>,
    );
    const sr = screen.getByText(label);
    expect(sr).toHaveClass('sr-only');
    const visible = screen.getByText('3');
    expect(visible).toHaveAttribute('aria-hidden', 'true');
    expect(visible.parentElement).toBe(sr.parentElement);
  });
});
