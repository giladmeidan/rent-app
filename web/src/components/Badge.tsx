import type { ReactNode } from 'react';

import { cx } from './cx';

export type BadgeTone = 'accent' | 'neutral' | 'solid' | 'inverse' | 'warning';
export type BadgeSize = 'sm' | 'md';

export type BadgeProps = {
  tone?: BadgeTone;
  size?: BadgeSize;
  /** Screen-reader text; the visible children are then hidden from assistive tech. */
  srLabel?: string;
  /** Layout only. */
  className?: string;
  children: ReactNode;
};

const TONES: Record<BadgeTone, string> = {
  // The brand's badges ("new").
  accent: 'bg-accent-soft text-accent-strong',
  neutral: 'bg-surface-subtle text-ink-muted',
  // Counts and the high-score pill; it is the screen's accent-filled element.
  solid: 'min-w-5 bg-accent text-on-ink tabular-nums',
  inverse: 'bg-ink text-on-ink',
  warning: 'bg-surface-subtle text-warning',
};

const SIZES: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-caption',
  md: 'px-2.5 py-1 text-label',
};

/** A count, "new", or a score pill. */
export function Badge({ tone = 'accent', size = 'sm', srLabel, className, children }: BadgeProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center justify-center whitespace-nowrap rounded-full',
        SIZES[size],
        TONES[tone],
        className,
      )}
    >
      {srLabel === undefined ? (
        children
      ) : (
        <>
          <span aria-hidden="true">{children}</span>
          <span className="sr-only">{srLabel}</span>
        </>
      )}
    </span>
  );
}
