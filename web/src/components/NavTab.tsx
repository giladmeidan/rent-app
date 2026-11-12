import type { ReactNode } from 'react';
import { NavLink } from 'react-router';

import { Badge } from './Badge';
import { cx } from './cx';
import { focusRing } from './focusRing';

export type NavTabProps = {
  to: string;
  /** An outline icon (`NavIcon`); shown above the label below `lg`, hidden from `lg`. */
  icon: ReactNode;
  label: string;
  /** A count at the icon's top-end corner (from `lg`, after the label); none when 0 or absent. */
  count?: number;
  /** The count as a sentence, which completes the tab's name ("צ'אט <sentence>"). */
  countLabel?: string;
};

/**
 * One tab of the signed-in navigation (spec 0009a): below `lg` a bottom-bar tab (the icon above a
 * caption label, equal widths, Search.dc.html / Inbox.dc.html); from `lg` a text tab in the top
 * bar, the active one with the accent bottom border of InboxDesktop.dc.html. `NavLink` marks the
 * current tab `aria-current="page"`, nested paths included.
 */
export function NavTab({ to, icon, label, count = 0, countLabel }: NavTabProps) {
  return (
    <NavLink
      to={to}
      className={cx(
        'relative flex min-h-tap min-w-0 items-center text-ink-muted aria-[current=page]:font-medium aria-[current=page]:text-accent',
        // The bottom bar: equal widths, the icon above the label.
        'max-lg:flex-1 max-lg:flex-col max-lg:justify-center max-lg:gap-1 max-lg:px-1 max-lg:text-caption max-lg:font-normal',
        // The top bar: text only, an accent underline on the active tab.
        'lg:gap-1 lg:hover:text-ink lg:border-b-2 lg:border-transparent lg:px-3 lg:text-label lg:font-normal lg:aria-[current=page]:border-accent',
        focusRing,
      )}
    >
      <span aria-hidden="true" className="inline-flex shrink-0 lg:hidden">
        {icon}
      </span>
      <span className="max-w-full truncate">{label}</span>
      {count > 0 && (
        <>
          {' '}
          <Badge
            tone="solid"
            srLabel={countLabel}
            className="max-lg:absolute max-lg:start-1/2 max-lg:top-1 max-lg:ms-1.5"
          >
            {count}
          </Badge>
        </>
      )}
    </NavLink>
  );
}

/** A tab's 22 px outline icon (the artboards' paths): stroke 2, round caps, `currentColor`. */
export function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}
