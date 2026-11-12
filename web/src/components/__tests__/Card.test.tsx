import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { Card } from '../Card';

const RING = [
  'has-[a:focus-visible]:outline',
  'has-[a:focus-visible]:outline-2',
  'has-[a:focus-visible]:outline-offset-2',
  'has-[a:focus-visible]:outline-accent',
];

const classesOf = (element: Element) => element.className.split(' ');

describe('Card', () => {
  it('ac3_card', () => {
    for (const as of ['div', 'article', 'section', 'li'] as const) {
      const { container, unmount } = render(<Card as={as}>{he.listings.card.room}</Card>);
      const card = container.firstElementChild as HTMLElement;
      expect(card.tagName).toBe(as.toUpperCase());
      expect(classesOf(card)).toEqual(
        expect.arrayContaining(['rounded-lg', 'bg-surface', 'border', 'border-border', 'p-3']),
      );
      unmount();
    }

    const variants = {
      default: ['bg-surface', 'border', 'border-border'],
      selected: ['bg-surface', 'border', 'border-accent', 'ring-1', 'ring-inset', 'ring-accent'],
      muted: ['bg-surface-subtle'],
    } as const;
    for (const [variant, classes] of Object.entries(variants)) {
      const { container, unmount } = render(
        <Card variant={variant as keyof typeof variants}>{he.listings.card.room}</Card>,
      );
      const card = container.firstElementChild as HTMLElement;
      expect(classesOf(card)).toEqual(expect.arrayContaining(['rounded-lg', ...classes]));
      expect(card.className).not.toMatch(/(^|\s)shadow-/);
      if (variant === 'muted') expect(classesOf(card)).not.toContain('border');
      unmount();
    }

    const paddings = { none: null, sm: 'p-3', md: 'p-4', lg: 'p-6' } as const;
    for (const [padding, cls] of Object.entries(paddings)) {
      const { container, unmount } = render(
        <Card padding={padding as keyof typeof paddings}>{he.listings.card.room}</Card>,
      );
      const card = container.firstElementChild as HTMLElement;
      if (cls === null) expect(card.className).not.toMatch(/(^|\s)p-\d/);
      else expect(classesOf(card)).toContain(cls);
      unmount();
    }

    // interactive: the focus ring that follows the stretched link, and the hover border on default only.
    const interactive = render(
      <>
        <Card interactive data-testid="default" />
        <Card interactive variant="selected" data-testid="selected" />
        <Card data-testid="static" />
      </>,
    );
    const def = interactive.getByTestId('default');
    expect(classesOf(def)).toEqual(
      expect.arrayContaining(['relative', ...RING, 'hover:border-border-strong']),
    );
    const selected = interactive.getByTestId('selected');
    expect(classesOf(selected)).toEqual(expect.arrayContaining(['relative', ...RING]));
    expect(classesOf(selected)).not.toContain('hover:border-border-strong');
    const plain = interactive.getByTestId('static');
    for (const cls of [...RING, 'hover:border-border-strong']) {
      expect(classesOf(plain)).not.toContain(cls);
    }
  });
});
