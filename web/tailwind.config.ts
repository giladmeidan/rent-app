import type { Config } from 'tailwindcss';

// The homie brand tokens (design/brand/tokens.json; names from specs/archive/0009-brand-amendment.md,
// spec 0009d). The brand kit wins over design/screens-v1/ for colour, type and shape.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: { DEFAULT: '#FFFFFF', subtle: '#F3F4F6' },
        ink: { DEFAULT: '#111111', muted: '#5B6370' },
        'on-ink': '#FFFFFF',
        accent: {
          DEFAULT: '#2563EB',
          strong: '#1D4ED8',
          soft: '#E8F0FE',
        },
        border: { DEFAULT: '#E5E7EB', strong: '#868E9B' },
        success: '#15803D',
        warning: '#B45309',
        danger: '#DC2626',
        mascot: { blush: '#BFD3FA', shade: '#DDE4F1' },
      },
      fontFamily: {
        display: [
          '"Fredoka Variable"',
          'Fredoka',
          '"Rubik Variable"',
          'Rubik',
          'system-ui',
          'sans-serif',
        ],
        sans: ['"Rubik Variable"', 'Rubik', 'system-ui', 'sans-serif'],
      },
      // Fredoka (font-display) goes only with display / h1 / h2; it never goes below 24px.
      fontSize: {
        display: ['48px', { lineHeight: '52px', fontWeight: '600' }],
        h1: ['32px', { lineHeight: '40px', fontWeight: '600' }],
        h2: ['24px', { lineHeight: '32px', fontWeight: '600' }],
        h3: ['18px', { lineHeight: '26px', fontWeight: '500' }],
        body: ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'body-sm': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        label: ['14px', { lineHeight: '20px', fontWeight: '500' }],
        caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
      },
      borderRadius: { sm: '8px', md: '12px', lg: '16px' },
      // No shadows on cards or sheets (they take `border`); only small control elevations.
      boxShadow: {
        thumb: '0 1px 3px rgba(0,0,0,0.2)',
        segment: '0 1px 2px rgba(0,0,0,0.08)',
        pin: '0 3px 8px rgba(0,0,0,0.12)',
      },
      // The touch target (44px) and the large button (52px); min-h / w / min-w / max-w reuse them.
      spacing: { tap: '2.75rem', '13': '3.25rem' },
      maxWidth: {
        narrow: '30rem',
        page: '45rem',
        wide: '83.5rem',
        dialog: 'min(28rem, calc(100% - 2rem))',
        'dialog-wide': 'min(40rem, calc(100% - 2rem))',
      },
    },
  },
} satisfies Config;
