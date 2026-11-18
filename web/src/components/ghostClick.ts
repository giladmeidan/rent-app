/** Longer than the gap between the two taps of a double tap. */
export const GHOST_CLICK_MS = 350;

let disarm: (() => void) | undefined;

/**
 * Drops the next pointer click for `GHOST_CLICK_MS`. Call it when a press removes the control under
 * the finger: the second tap of a double tap would otherwise land on whatever is there now. A click
 * from the keyboard or assistive technology has `detail` 0 and always goes through.
 */
export function swallowGhostClick(): void {
  disarm?.();
  const onClick = (event: MouseEvent) => {
    if (event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
    disarm?.();
  };
  document.addEventListener('click', onClick, true);
  const timer = setTimeout(() => disarm?.(), GHOST_CLICK_MS);
  disarm = () => {
    clearTimeout(timer);
    document.removeEventListener('click', onClick, true);
    disarm = undefined;
  };
}
