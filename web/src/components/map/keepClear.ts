// The search map keeps the pressed pin visible above its docked card (spec 0009w). Pure, so the
// decision is unit-tested while `MapCanvas` (which measures the real boxes) is faked.

/** A screen box, as `getBoundingClientRect()` gives it. */
export type ScreenRect = Pick<DOMRectReadOnly, 'top' | 'bottom' | 'left' | 'right'>;

/**
 * How far to pan the map up (`panBy([0, y])`: positive y moves the content up) so the pin's box
 * ends `margin` px above the card's top; `null` when the two boxes, each kept `margin` apart, do
 * not meet (vertically or horizontally), so a pin beside the card never moves the map.
 */
export function keepClearPan(pin: ScreenRect, card: ScreenRect, margin = 8): number | null {
  const meet =
    pin.bottom + margin > card.top &&
    pin.top - margin < card.bottom &&
    pin.right + margin > card.left &&
    pin.left - margin < card.right;
  return meet ? pin.bottom - card.top + margin : null;
}
