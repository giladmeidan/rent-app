import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import he from '../../locales/he.json';
import { ErrorState } from '../ErrorState';

const classesOf = (element: Element) => element.className.split(' ');

describe('ErrorState', () => {
  it('ac5_retry_ink_pill', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(he.common.error);
    expect(classesOf(alert)).toEqual(expect.arrayContaining(['rounded-lg', 'border-border']));

    const retry = screen.getByRole('button', { name: he.common.retry });
    expect(alert.contains(retry)).toBe(true);
    expect(classesOf(retry)).toEqual(
      expect.arrayContaining([
        'bg-ink',
        'text-on-ink',
        'rounded-full',
        'min-h-tap',
        'focus-visible:outline-accent',
      ]),
    );
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
