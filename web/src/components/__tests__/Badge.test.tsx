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

  it('forwards data attributes and other HTML attributes to the span', () => {
    render(
      <Badge data-testid="the-badge" data-bucket="high" title="t">
        {he.chat.list.new}
      </Badge>,
    );
    const badge = screen.getByTestId('the-badge');
    expect(badge).toHaveAttribute('data-bucket', 'high');
    expect(badge).toHaveAttribute('title', 't');
    expect(badge).toHaveTextContent(he.chat.list.new);
    expect(classesOf(badge)).toEqual(expect.arrayContaining(['rounded-full', 'bg-accent-soft']));
  });

  it('forwards_attributes', () => {
    render(
      <Badge data-testid="application-status" id="b1" aria-label="x">
        {he.chat.list.new}
      </Badge>,
    );
    const badge = screen.getByTestId('application-status');
    expect(badge).toHaveAttribute('id', 'b1');
    expect(badge).toHaveAttribute('aria-label', 'x');
    expect(badge.tagName).toBe('SPAN');
    // Its own classes survive: layout `className` is still merged.
    expect(badge).toHaveClass('inline-flex', 'rounded-full');
  });

  it('danger_tone', () => {
    render(<Badge tone="danger">{he.applicants.status.declined}</Badge>);
    const badge = screen.getByText(he.applicants.status.declined);
    expect(classesOf(badge)).toEqual(
      expect.arrayContaining(['border', 'border-border', 'bg-surface', 'text-danger']),
    );
    expect(badge.querySelector('svg')).toBeNull();
  });

  it('success_tone', () => {
    render(<Badge tone="success">{he.applicants.status.shortlisted}</Badge>);
    const badge = screen.getByText(he.applicants.status.shortlisted);
    expect(classesOf(badge)).toEqual(
      expect.arrayContaining(['border', 'border-border', 'bg-surface', 'text-success']),
    );
    const icon = badge.querySelector('svg');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    // The icon comes first; the words are the badge's only text.
    expect(badge.firstElementChild).toBe(icon);
    expect(badge.textContent).toBe(he.applicants.status.shortlisted);
  });
});
