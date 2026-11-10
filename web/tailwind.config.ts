import type { Config } from 'tailwindcss';

// Tokens from design/screens-v1/Main.dc.html (see design/README.md).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#F7F5F2',
        ink: '#1C1917',
        muted: '#57534E',
        accent: { DEFAULT: '#0E7C6B', tint: '#E6F4F1', text: '#0B5F52' },
        line: '#E7E5E4',
      },
    },
  },
} satisfies Config;
