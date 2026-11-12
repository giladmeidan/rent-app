/**
 * The brand focus ring (accent), for every interactive kit element. A ring on the outline, so it
 * never shifts layout.
 */
export const focusRing =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * The same ring in `ink`, for controls filled with `accent`, where a blue ring would read as a
 * thicker control. Primary buttons are `ink`, so they take `focusRing`.
 */
export const focusRingInk =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink';
