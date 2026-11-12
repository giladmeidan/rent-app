import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import resolveConfig from 'tailwindcss/resolveConfig';
import { describe, expect, it } from 'vitest';

import config from '../../../tailwind.config';

type Nested = { [key: string]: string | Nested };
type BrandTokens = { color: { tokens: { name: string; value: string }[] } };

const brand = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      'design',
      'brand',
      'tokens.json',
    ),
    'utf8',
  ),
) as BrandTokens;

/** Flattens a Tailwind colour map to its class suffixes (`{ ink: { muted } }` → `ink-muted`). */
function classSuffixes(colors: Nested, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(colors)) {
    const name = key === 'DEFAULT' ? prefix : prefix === '' ? key : `${prefix}-${key}`;
    if (typeof value === 'string') out[name] = value;
    else Object.assign(out, classSuffixes(value, name));
  }
  return out;
}

describe('tailwind.config.ts', () => {
  it('ac1_token_scale', () => {
    const extend = config.theme.extend;

    // Scope §1, group by group (the deprecated aliases until 0009h removes them).
    expect(extend.colors).toEqual({
      surface: { DEFAULT: '#FFFFFF', subtle: '#F3F4F6' },
      ink: { DEFAULT: '#111111', muted: '#5B6370' },
      'on-ink': '#FFFFFF',
      accent: {
        DEFAULT: '#2563EB',
        strong: '#1D4ED8',
        soft: '#E8F0FE',
        tint: '#E8F0FE',
        text: '#1D4ED8',
      },
      border: { DEFAULT: '#E5E7EB', strong: '#868E9B' },
      success: '#15803D',
      warning: '#B45309',
      danger: '#DC2626',
      mascot: { blush: '#BFD3FA', shade: '#DDE4F1' },
      bg: '#FFFFFF',
      muted: '#5B6370',
      line: '#E5E7EB',
      warn: { DEFAULT: '#F3F4F6', text: '#B45309' },
    });
    expect(extend.fontFamily).toEqual({
      display: ['Fredoka', '"Rubik Variable"', 'Rubik', 'system-ui', 'sans-serif'],
      sans: ['"Rubik Variable"', 'Rubik', 'system-ui', 'sans-serif'],
    });
    expect(extend.fontSize).toEqual({
      display: ['48px', { lineHeight: '52px', fontWeight: '600' }],
      h1: ['32px', { lineHeight: '40px', fontWeight: '600' }],
      h2: ['24px', { lineHeight: '32px', fontWeight: '600' }],
      h3: ['18px', { lineHeight: '26px', fontWeight: '500' }],
      body: ['16px', { lineHeight: '24px', fontWeight: '400' }],
      'body-sm': ['14px', { lineHeight: '20px', fontWeight: '400' }],
      label: ['14px', { lineHeight: '20px', fontWeight: '500' }],
      caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
    });
    expect(extend.borderRadius).toEqual({ sm: '8px', md: '12px', lg: '16px' });
    expect(extend.boxShadow).toEqual({
      thumb: '0 1px 3px rgba(0,0,0,0.2)',
      segment: '0 1px 2px rgba(0,0,0,0.08)',
      pin: '0 3px 8px rgba(0,0,0,0.12)',
    });
    expect(extend.spacing).toEqual({ tap: '2.75rem', '13': '3.25rem' });
    expect(extend.maxWidth).toEqual({
      narrow: '30rem',
      page: '45rem',
      wide: '83.5rem',
      dialog: 'min(28rem, calc(100% - 2rem))',
    });

    // Every brand colour is its tokens.json value, read from the file.
    const suffixes = classSuffixes(extend.colors as Nested);
    expect(brand.color.tokens).toHaveLength(15);
    for (const token of brand.color.tokens) {
      expect(suffixes[token.name], token.name).toBe(token.value);
    }

    // Tailwind resolves the scale the kit's classes use.
    const theme = resolveConfig(config).theme as unknown as Record<string, Record<string, unknown>>;
    expect(theme.minHeight?.tap).toBe('2.75rem');
    expect(theme.minHeight?.['13']).toBe('3.25rem');
    expect(theme.width?.tap).toBe('2.75rem');
    expect((theme.colors?.ink as Nested).DEFAULT).toBe('#111111');
    expect((theme.colors?.border as Nested).strong).toBe('#868E9B');
    expect((theme.colors?.mascot as Nested).blush).toBe('#BFD3FA');
    expect(theme.borderRadius?.md).toBe('12px');
    expect(theme.maxWidth?.dialog).toBe('min(28rem, calc(100% - 2rem))');
    expect(theme.fontSize?.h1).toEqual(['32px', { lineHeight: '40px', fontWeight: '600' }]);
  });
});
