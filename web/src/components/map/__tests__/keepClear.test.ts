import { describe, expect, it } from 'vitest';

import { keepClearPan, type ScreenRect } from '../keepClear';

/** A box from its top-left corner and size. */
const box = (left: number, top: number, width: number, height: number): ScreenRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

// A phone's docked card (358 px map, 12 px gutters) and a desktop one (360 px at the inline end).
const PHONE_CARD = box(12, 296, 334, 178);
const DESKTOP_CARD = box(12, 350, 360, 178);

describe('keepClearPan', () => {
  it('ac7_keep_visible_pan_decision', () => {
    // Apart vertically (the pin's bottom more than 8 px above the card) or horizontally: no pan.
    expect(keepClearPan(box(150, 231, 74, 44), PHONE_CARD)).toBeNull();
    expect(keepClearPan(box(150, 600, 74, 44), PHONE_CARD)).toBeNull();
    expect(keepClearPan(box(400, 400, 74, 44), PHONE_CARD)).toBeNull();

    // Overlapping: up by the overlap plus the margin, so the pin's bottom ends 8 px above the card.
    const pin = box(150, 392, 74, 44);
    const pan = keepClearPan(pin, PHONE_CARD);
    expect(pan).toBe(pin.bottom - PHONE_CARD.top + 8);
    expect(pan).toBe(148);
    expect(pin.bottom - (pan ?? 0)).toBe(PHONE_CARD.top - 8);

    // The pin's bottom inside the 8 px margin above the card (not touching it): it still pans.
    expect(keepClearPan(box(150, 247, 74, 44), PHONE_CARD)).toBe(3);
    // Exactly 8 px above: clear.
    expect(keepClearPan(box(150, 244, 74, 44), PHONE_CARD)).toBeNull();

    // A pin entirely beside the desktop card (the map's centre, at the card's height): no pan.
    expect(keepClearPan(box(500, 420, 130, 44), DESKTOP_CARD)).toBeNull();
    // Within 8 px of its side it counts as meeting.
    expect(keepClearPan(box(378, 420, 130, 44), DESKTOP_CARD)).toBe(464 - 350 + 8);
    // A custom margin.
    expect(keepClearPan(box(150, 231, 74, 44), PHONE_CARD, 30)).toBe(275 - 296 + 30);
  });
});
