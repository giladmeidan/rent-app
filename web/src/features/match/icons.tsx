// The explanation's markers, in the brand look (design/brand): outline, stroke 2, round caps,
// `currentColor`. An agreeing line gets the check on an `accent-soft` disc; the differing line gets
// a "!" in `warning`. `warning` is a text and icon colour that always comes with words, so the
// line's own text carries the meaning and the icon only repeats it. Decorative: `aria-hidden`.

const circle = 'flex size-6 shrink-0 items-center justify-center rounded-full';

const svgProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function AgreeIcon() {
  return (
    <span aria-hidden="true" className={`${circle} bg-accent-soft`}>
      <svg {...svgProps} className="text-accent-strong">
        <path d="M5 12l5 5 9-10" />
      </svg>
    </span>
  );
}

export function DifferIcon() {
  return (
    <span aria-hidden="true" className={circle}>
      <svg {...svgProps} className="text-warning">
        <path d="M12 6v7" />
        <circle cx="12" cy="17.5" r="1" />
      </svg>
    </span>
  );
}
