import type { HTMLAttributes, ReactNode } from 'react';

import { cx } from './cx';

export type PageWidth = 'narrow' | 'default' | 'wide';

export type PageContainerProps = Omit<HTMLAttributes<HTMLElement>, 'className' | 'children'> & {
  /** `narrow` 480px (forms), `default` 720px, `wide` 1336px (search, inbox). */
  width?: PageWidth;
  as?: 'div' | 'section' | 'article';
  /** Layout only (e.g. the page's vertical padding and gaps). */
  className?: string;
  children?: ReactNode;
};

const WIDTHS: Record<PageWidth, string> = {
  narrow: 'max-w-narrow',
  default: 'max-w-page',
  wide: 'max-w-wide',
};

/**
 * The page column, a direct child of `<main>`. The gutters sit outside the width (`box-content`),
 * and phones keep the brand's 16px. A page that bleeds to the edges does not use it.
 */
export function PageContainer({
  width = 'default',
  as: Element = 'div',
  className,
  children,
  ...rest
}: PageContainerProps) {
  return (
    <Element
      {...rest}
      className={cx('mx-auto box-content px-4 md:px-6 lg:px-8', WIDTHS[width], className)}
    >
      {children}
    </Element>
  );
}
