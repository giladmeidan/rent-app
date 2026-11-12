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
      // The test id and bucket are on the badge element itself, which is a `Badge size="md"`.
      expect(badge).toHaveAttribute('data-testid', 'match-badge');
      expect(badge).toHaveAttribute('data-bucket', expected);
      expect(badge).toHaveClass('text-label', 'rounded-full');
      if (accent) {
        expect(badge).toHaveClass('bg-accent-soft', 'text-accent-strong');
        expect(badge).not.toHaveClass('bg-surface-subtle');
        expect(badge).not.toHaveClass('bg-accent');
      } else {
        expect(badge).toHaveClass('bg-surface-subtle', 'text-ink-muted');
        expect(badge).not.toHaveClass('bg-accent-soft');
      }
      view.unmount();
    }
  });
});
