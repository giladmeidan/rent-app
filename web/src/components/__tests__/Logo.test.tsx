import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { Logo, type LogoProps } from '../Logo';

const file = (img: HTMLElement) => (img.getAttribute('src') ?? '').split('/').pop();

describe('Logo', () => {
  it('ac8_logo_files_and_alt', () => {
    const cases: [LogoProps, string][] = [
      [{}, 'homie-wordmark-he.svg'],
      [{ tone: 'dark' }, 'homie-wordmark-he.svg'],
      [{ tone: 'white' }, 'homie-wordmark-he-white.svg'],
      [{ lang: 'en' }, 'homie-wordmark-en.svg'],
      [{ variant: 'wordmark', tone: 'white', lang: 'en' }, 'homie-wordmark-en-white.svg'],
      [{ variant: 'lockup' }, 'homie-lockup-he.svg'],
      [{ variant: 'lockup', tone: 'dark', lang: 'he' }, 'homie-lockup-he.svg'],
      [{ variant: 'lockup', lang: 'en' }, 'homie-lockup-en.svg'],
    ];
    for (const [props, expected] of cases) {
      const { unmount } = render(<Logo {...props} className="h-7" />);
      const img = screen.getByRole('img', { name: he.app.title });
      expect(img.tagName).toBe('IMG');
      expect(file(img)).toBe(expected);
      expect(img).toHaveAttribute('alt', he.app.title);
      expect(img).toHaveClass('w-auto', 'h-7');
      expect(img).not.toHaveAttribute('width');
      unmount();
    }

    // Decorative: an empty alt, still w-auto.
    const { container } = render(<Logo decorative />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveClass('w-auto');
    expect(screen.queryByRole('img')).toBeNull();
  });
});
