import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Avatar } from '../Avatar';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every non-test source file under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('Avatar', () => {
  it('ac3_avatar', () => {
    const root = (container: HTMLElement) => container.firstElementChild as HTMLElement;

    // The initial: the first code point of the name (a whole emoji, not half of it).
    const initial = render(<Avatar name="אבי" size="md" />);
    expect(root(initial.container)).toHaveTextContent(/^א$/);
    expect(initial.container.querySelector('img')).toBeNull();
    expect(root(initial.container)).toHaveAttribute('aria-hidden', 'true');
    initial.rerender(<Avatar name="🏠 בית" size="md" />);
    expect(root(initial.container).textContent).toBe('🏠');
    initial.rerender(<Avatar name="" size="md" />);
    expect(root(initial.container).textContent).toBe('');
    initial.unmount();

    // The photo: decorative, lazy, filling the circle.
    const view = render(<Avatar name="אבי" photoUrl="https://media.test/a-s.webp" size="md" />);
    const img = view.container.querySelector('img') as HTMLImageElement;
    expect(img).toHaveAttribute('src', 'https://media.test/a-s.webp');
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(img).toHaveClass('size-full', 'rounded-full', 'object-cover');
    expect(root(view.container)).toHaveAttribute('aria-hidden', 'true');
    expect(root(view.container).textContent).toBe('');

    // It fails to load: the initial.
    fireEvent.error(img);
    expect(view.container.querySelector('img')).toBeNull();
    expect(root(view.container)).toHaveTextContent(/^א$/);

    // A new address is tried again.
    view.rerender(<Avatar name="אבי" photoUrl="https://media.test/b-s.webp" size="md" />);
    expect(view.container.querySelector('img')).toHaveAttribute(
      'src',
      'https://media.test/b-s.webp',
    );
    // No photo (null): the initial.
    view.rerender(<Avatar name="אבי" photoUrl={null} size="md" />);
    expect(view.container.querySelector('img')).toBeNull();
    view.unmount();

    // Sizes and tones.
    const sizes = { sm: 'size-10', md: 'size-12', lg: 'size-14', xl: 'size-24' } as const;
    for (const [size, cls] of Object.entries(sizes) as [keyof typeof sizes, string][]) {
      const v = render(<Avatar name="א" size={size} />);
      expect(root(v.container)).toHaveClass(cls, 'rounded-full', 'flex-none');
      expect(root(v.container)).toHaveClass('bg-surface-subtle', 'text-ink-muted');
      v.unmount();
    }
    const accent = render(<Avatar name="א" size="sm" tone="accent" className="extra" />);
    expect(root(accent.container)).toHaveClass('bg-accent-soft', 'text-accent-strong', 'extra');
    accent.unmount();

    // The five sites use it with their sizes and tones.
    const sites: [string, RegExp][] = [
      [
        'features/people/PersonCard.tsx',
        /<Avatar name=\{name\} photoUrl=\{person\.photo_url\} size="md" \/>/,
      ],
      [
        'features/chat/ConversationsPane.tsx',
        /<Avatar[^>]*other_photo_url[^>]*size="md"[^>]*tone="accent"/s,
      ],
      [
        'features/applicants/ApplicantCard.tsx',
        /<Avatar[^>]*applicant\.photo_url[^>]*size="md"[^>]*compact && selected \? 'accent' : 'neutral'/s,
      ],
      [
        'features/applicants/ApplicantPane.tsx',
        /<Avatar[^>]*applicant\.photo_url[^>]*size="lg" tone="accent"/s,
      ],
      [
        'features/flatmates/FlatmatesPage.tsx',
        /<Avatar[^>]*flatmate\.photo_url[^>]*size="sm" tone="accent"/s,
      ],
    ];
    for (const [file, pattern] of sites) {
      expect(readFileSync(join(src, file), 'utf8'), file).toMatch(pattern);
    }

    // No other first-initial circle remains under features/.
    for (const file of sources(join(src, 'features'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/Array\.from\([^)]*\)\[0\]/);
    }
  });
});
