/** Longer than the gap between the two taps of a double tap. */
export const GHOST_CLICK_MS = 350;
/** How far from the first tap the second one of a double tap can land. */
export const GHOST_CLICK_RADIUS_PX = 40;

/** The click that removed a control. `detail` is 0 for a keyboard or assistive technology. */
export type GhostPress = Pick<MouseEvent, 'detail' | 'clientX' | 'clientY'>;

let disarm: (() => void) | undefined;

/**
 * After `press` removed the control under the finger, drops a second tap at the same place for
 * `GHOST_CLICK_MS`: it would otherwise land on whatever is there now. A click anywhere else goes
 * through, and so does any click after a press that was not a pointer's.
 */
export function swallowGhostClick(press: GhostPress): void {
  disarm?.();
  if (press.detail === 0) return;
  const onClick = (event: MouseEvent) => {
    if (event.detail === 0) return;
    const distance = Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY);
    if (distance > GHOST_CLICK_RADIUS_PX) return;
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
