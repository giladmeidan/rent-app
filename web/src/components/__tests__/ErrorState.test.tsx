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

  it('ac4_page_variant_renders_h1', () => {
    // `page`: the message is the page's <h1>, with no <p>.
    const onRetry = vi.fn();
    const view = render(<ErrorState page onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(he.common.error);
    expect(alert.querySelector('p')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: he.common.retry }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    view.unmount();

    // Default: a paragraph inside a page that has its own <h1>.
    render(<ErrorState onRetry={onRetry} />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByText(he.common.error).tagName).toBe('P');
  });
});
