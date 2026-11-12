import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from './cx';

export type TagTone = 'neutral' | 'accent' | 'warning' | 'inverse';
export type TagSize = 'sm' | 'md';

export type TagProps = Omit<HTMLAttributes<HTMLElement>, 'children' | 'className'> & {
  tone?: TagTone;
  size?: TagSize;
  /** A leading outline icon, hidden from assistive tech. */
  icon?: ReactNode;
  as?: 'span' | 'li';
  /** Layout only. */
  className?: string;
  children: ReactNode;
};

const TONES: Record<TagTone, string> = {
  neutral: 'border border-border bg-surface-subtle text-ink',
  accent: 'bg-accent-soft text-accent-strong',
  // The words carry the status; the colour only repeats it.
  warning: 'bg-surface-subtle text-warning',
  // The one badge allowed in a photo's top corner.
  inverse: 'bg-ink text-on-ink',
};

const SIZES: Record<TagSize, string> = {
  sm: 'px-2.5 py-1 text-caption',
  md: 'px-3 py-1.5 text-label',
};

/** A static chip. The selectable chip is `ChoiceGroup`. */
export function Tag({
  tone = 'neutral',
  size = 'md',
  icon,
  as: Element = 'span',
  className,
  children,
  ...rest
}: TagProps) {
  return (
    <Element
      {...rest}
      className={cx(
        'inline-flex items-center gap-1 rounded-full',
        SIZES[size],
        TONES[tone],
        className,
      )}
    >
      {icon !== undefined && icon !== null && (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      )}
      {children}
    </Element>
  );
}
