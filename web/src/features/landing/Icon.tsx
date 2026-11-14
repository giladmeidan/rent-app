import type { ReactNode } from 'react';

/** An outline icon (the artboard's paths): stroke 2, round caps, `currentColor`, decorative. */
export function Icon({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** The "more" chevron: it points to the inline end (the left, in RTL). */
export function Chevron({ size = 20 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M15 6l-6 6 6 6" />
    </Icon>
  );
}

/** A check mark (the trust claims and the "why" lines). */
export function Check({ size = 18 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M5 12l5 5 9-10" />
    </Icon>
  );
}
