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
  title: string;
  subtitle?: string;
  /** The page's actions, at the row's inline end. */
  actions?: ReactNode;
  back?: BackLinkProps;
  /** Lets a page move focus to its `<h1>` (it has `tabIndex={-1}`). */
  titleRef?: Ref<HTMLHeadingElement>;
  titleId?: string;
  /** Layout only. */
  className?: string;
};

/** The page's back link, `<h1>`, subtitle and actions. Landmarks are the page's (0009c). */
export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  titleRef,
  titleId,
  className,
}: PageHeaderProps) {
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      {back !== undefined && <BackLink {...back} />}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1
            ref={titleRef}
            id={titleId}
            tabIndex={-1}
            className="font-display text-h2 lg:text-h1 break-words focus:outline-none"
          >
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
