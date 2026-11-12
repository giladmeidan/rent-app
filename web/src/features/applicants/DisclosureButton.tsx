import type { ReactNode } from 'react';

import { Button } from '../../components/Button';

type Props = {
  open: boolean;
  /** The id of the panel it opens (`aria-controls`). */
  controls: string;
  /** The id of the element that names what the panel is about. */
  describedBy?: string;
  onToggle: () => void;
  children: ReactNode;
};

/** A "show more" disclosure: the label, then a chevron that turns while the panel is open. */
export function DisclosureButton({ open, controls, describedBy, onToggle, children }: Props) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-expanded={open}
      aria-controls={controls}
      aria-describedby={describedBy}
      onClick={onToggle}
    >
      {children}
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
        className={`transition-transform motion-reduce:transition-none${open ? ' rotate-180' : ''}`}
      >
        <path d="M6 9l6 6 6-6" />
      </svg>
    </Button>
  );
}
