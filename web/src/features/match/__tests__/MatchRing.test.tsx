import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import he from '../../../locales/he.json';
import { MatchRing } from '../MatchRing';

const scoreText = (score: number) => he.match.card.score.replace('{{score}}', String(score));
const words = (score: number) => he.match.badge.replace('{{score}}', String(score));

describe('MatchRing', () => {
  it('ac9_ring', () => {
    // 80 is high: the accent ring. 79 and 59 are neutral.
    const cases: [number, 'high' | 'good' | 'partial'][] = [
      [80, 'high'],
      [79, 'good'],
      [59, 'partial'],
    ];
    for (const [score, level] of cases) {
      const view = render(<MatchRing score={score} size="md" />);
      const root = screen.getByTestId('match-ring');
      expect(root).toHaveAttribute('data-bucket', level);
      expect(root).toHaveClass('inline-flex', 'flex-col', 'items-center', 'gap-0.5');
      const ring = screen.getByText(scoreText(score));
      expect(ring).toHaveClass('rounded-full', 'flex', 'items-center', 'justify-center');
      expect(ring).toHaveClass('size-12', 'border-2', 'text-label', 'tabular-nums');
      if (level === 'high') {
        expect(ring).toHaveClass('border-accent', 'bg-accent-soft', 'text-accent-strong');
      } else {
        expect(ring).toHaveClass('border-border-strong', 'bg-surface-subtle', 'text-ink-muted');
        expect(ring).not.toHaveClass('border-accent');
      }
      // Rubik: Fredoka is never used below 24px.
      expect(ring).not.toHaveClass('font-display');
      view.unmount();
    }

    // No label by default; `label` adds "התאמה" under the ring, and it is hidden from AT.
    const plain = render(<MatchRing score={87} size="md" />);
    expect(screen.queryByText(he.match.ring.label, { exact: true })).toBeNull();
    plain.unmount();
    render(<MatchRing score={87} size="md" label />);
    const label = screen.getByText(he.match.ring.label, { exact: true });
    expect(label).toHaveClass('text-caption', 'font-semibold', 'text-ink-muted');
    expect(label).toHaveAttribute('aria-hidden', 'true');

    // The sr-only text is "התאמה 87%"; the visible parts are aria-hidden.
    const sr = screen.getByText(words(87));
    expect(sr).toHaveClass('sr-only');
    expect(screen.getByText(scoreText(87))).toHaveAttribute('aria-hidden', 'true');
  });

  it('ac9_ring: lg is size-14', () => {
    render(<MatchRing score={90} size="lg" />);
    expect(screen.getByText(scoreText(90))).toHaveClass('size-14', 'border-4', 'text-h3');
    expect(screen.getByText(scoreText(90))).not.toHaveClass('size-12');
  });
});
