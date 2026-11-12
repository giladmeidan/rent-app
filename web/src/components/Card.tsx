import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from './cx';

export type CardVariant = 'default' | 'selected' | 'muted';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

export type CardProps = Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'> & {
  as?: 'div' | 'article' | 'section' | 'li';
  variant?: CardVariant;
  /** `sm` (12px) is the brand's card padding. */
  padding?: CardPadding;
  /** For a card whose title link is stretched over it: the ring follows the link's focus. */
  interactive?: boolean;
  /** Layout only. */
  className?: string;
  children?: ReactNode;
};

const VARIANTS: Record<CardVariant, string> = {
  default: 'bg-surface border border-border',
  // Two pixels of accent with no layout shift.
  selected: 'bg-surface border border-accent ring-1 ring-inset ring-accent',
  muted: 'bg-surface-subtle',
};

const PADDINGS: Record<CardPadding, string | false> = {
  none: false,
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

const INTERACTIVE =
  'relative has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-accent';

/** The bordered box: always `rounded-lg`, never a shadow. */
export function Card({
  as: Element = 'div',
  variant = 'default',
  padding = 'sm',
  interactive = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <Element
      {...rest}
      className={cx(
        'rounded-lg',
        VARIANTS[variant],
        PADDINGS[padding],
        interactive && INTERACTIVE,
        interactive && variant === 'default' && 'hover:border-border-strong',
        className,
      )}
    >
      {children}
    </Element>
  );
}
