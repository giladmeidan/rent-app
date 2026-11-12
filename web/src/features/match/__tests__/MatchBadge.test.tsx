import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { bucket } from '../bucket';
import { MatchBadge } from '../MatchBadge';

describe('MatchBadge', () => {
  it('ac1_buckets', () => {
    const cases: [number, 'high' | 'good' | 'partial', boolean][] = [
      [100, 'high', true],
      [80, 'high', true],
      [79, 'good', false],
      [60, 'good', false],
      [59, 'partial', false],
      [0, 'partial', false],
    ];
    for (const [score, expected, accent] of cases) {
      expect(bucket(score), String(score)).toBe(expected);
      const view = render(<MatchBadge score={score} />);
      const badge = screen.getByText(`התאמה ${String(score)}%`);
      // "87%" is one number run: no `dir` attribute.
      expect(badge).not.toHaveAttribute('dir');
      if (accent) {
        expect(badge).toHaveClass('bg-accent', 'text-on-ink');
        expect(badge).not.toHaveClass('bg-surface-subtle');
      } else {
        expect(badge).toHaveClass('bg-surface-subtle', 'text-ink-muted');
        expect(badge).not.toHaveClass('bg-accent');
      }
      view.unmount();
    }
  });
});
