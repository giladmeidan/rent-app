import type { MouseEvent, ReactNode, Ref } from 'react';
import { Link } from 'react-router';

import { cx } from './cx';
import { focusRing } from './focusRing';

export type BackLinkProps = {
  to: string;
  label: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

/** The shared back link: a chevron that points to the inline start, then the label. */
export function BackLink({ to, label, onClick }: BackLinkProps) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className={cx(
        'inline-flex min-h-tap items-center gap-1 self-start rounded-md text-label text-ink-muted hover:text-ink',
        focusRing,
      )}
    >
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 ltr:rotate-180"
      >
        <path d="M9 6l6 6-6 6" />
      </svg>
      {label}
    </Link>
  );
}

export type PageHeaderProps = {
  /** Text, or a node (a `<span dir="auto">` around a person's name). */
  title: ReactNode;
  /** A small line above the title, inside the `<h1>`: the accessible name is "eyebrow title". */
  eyebrow?: string;
  subtitle?: string;
  /** The page's actions, at the row's inline end. */
  actions?: ReactNode;
  back?: BackLinkProps;
  /** Lets a page move focus to its `<h1>` (it has `tabIndex={-1}`). */
  titleRef?: Ref<HTMLHeadingElement>;
  titleId?: string;
  /**
   * `compact`: below `lg` the back link and a Rubik title share one row (a band's title bar; Fredoka
   * is never below 24px); at `lg` it renders as `default`.
   */
  size?: 'default' | 'compact';
  /** Layout only. */
  className?: string;
};

/** The page's back link, `<h1>`, subtitle and actions. Landmarks are the page's (0009c). */
export function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
  back,
  titleRef,
  titleId,
  size = 'default',
  className,
}: PageHeaderProps) {
  const compact = size === 'compact';
  return (
    <div
      className={cx(
        'flex',
        compact ? 'items-center gap-2 lg:flex-col lg:items-stretch lg:gap-1' : 'flex-col gap-1',
        className,
      )}
    >
      {back !== undefined && <BackLink {...back} />}
      <div
        className={cx(
          'flex flex-wrap items-end justify-between gap-x-4 gap-y-3',
          compact && 'min-w-0 flex-1 lg:flex-none',
        )}
      >
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            ref={titleRef}
            id={titleId}
            tabIndex={-1}
            className={cx(
              compact
                ? 'font-sans text-body font-medium lg:font-display lg:text-h1'
                : 'font-display text-h2 lg:text-h1',
              'break-words focus:outline-none',
            )}
          >
            {eyebrow !== undefined && (
              <>
                {/* The h1 is Fredoka; the eyebrow is 12px, so it goes back to Rubik. */}
                <span className="block font-sans text-caption text-ink-muted">{eyebrow}</span>{' '}
              </>
            )}
            {title}
          </h1>
          {subtitle !== undefined && <p className="text-body-sm text-ink-muted">{subtitle}</p>}
        </div>
        {actions !== undefined && actions !== null && (
          <div className="flex flex-wrap gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
}
