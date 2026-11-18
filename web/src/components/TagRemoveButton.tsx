import type { ButtonHTMLAttributes } from 'react';

import { cx } from './cx';
import { focusRing } from './focusRing';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children' | 'type'> & {
  /** What the press removes: the button shows only an icon. */
  'aria-label': string;
};

/** The small X inside a `Tag`: a 24 px look with a 44 px hit area. */
export function TagRemoveButton({ className, ...rest }: Props) {
  return (
    <button
      {...rest}
      type="button"
      className={cx(
        "relative inline-flex size-6 shrink-0 items-center justify-center rounded-full after:absolute after:-inset-2.5 after:content-['']",
        focusRing,
        className,
      )}
    >
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
