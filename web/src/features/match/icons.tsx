// The explanation's markers, as Listing.dc.html: a teal tick for an agreeing line, an amber "!" for
// the differing one. Decorative: the line's words carry the meaning.

const circle = 'flex size-6 shrink-0 items-center justify-center rounded-full';

export function AgreeIcon() {
  return (
    <span aria-hidden="true" className={`${circle} bg-accent-soft`}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        className="text-accent-strong"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12l5 5 9-10" />
      </svg>
    </span>
  );
}

export function DifferIcon() {
  return (
    <span aria-hidden="true" className={`${circle} bg-surface-subtle`}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        className="text-warning"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 6v7" />
        <circle cx="12" cy="17.5" r="1" />
      </svg>
    </span>
  );
}
