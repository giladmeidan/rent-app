import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DateReadback, isIsoDay } from '../DateReadback';

// "התאריך שנבחר: 12 בנובמבר 2026"
const CHOSEN = 'התאריך שנבחר: 12 בנובמבר 2026';

describe('DateReadback', () => {
  it('ac3_reads_the_day_back', () => {
    const { container, rerender } = render(<DateReadback id="d" value="2026-11-12" />);
    expect(screen.getByText(CHOSEN)).toHaveAttribute('id', 'd');
    expect(isIsoDay('2026-11-12')).toBe(true);

    for (const value of ['', '2026-13-40', '2026-02-30']) {
      rerender(<DateReadback id="d" value={value} />);
      expect(container).toBeEmptyDOMElement();
      expect(isIsoDay(value), value).toBe(false);
    }
  });
});
