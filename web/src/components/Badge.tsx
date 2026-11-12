import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from './cx';

export type BadgeTone = 'accent' | 'neutral' | 'solid' | 'inverse' | 'warning' | 'success';
export type BadgeSize = 'sm' | 'md';

export type BadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'className'> & {
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
  // Counts (the nav and likes count badge); it is the screen's accent-filled element.
  solid: 'min-w-5 bg-accent text-on-ink tabular-nums',
  inverse: 'bg-ink text-on-ink',
  warning: 'bg-surface-subtle text-warning',
  // A positive status: success text on a bordered surface, always with its check icon and words.
  success: 'gap-1 border border-border bg-surface text-success',
};

const SIZES: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-caption',
  md: 'px-2.5 py-1 text-label',
};

/** A count, "new", or a score pill. */
export function Badge({
  tone = 'accent',
  size = 'sm',
  srLabel,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      {...rest}
      className={cx(
        'inline-flex items-center justify-center whitespace-nowrap rounded-full',
        SIZES[size],
        TONES[tone],
        className,
      )}
    >
      {tone === 'success' && <CheckIcon />}
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

/** The success tone's leading mark: an outline check, decorative (the words carry the meaning). */
function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}
