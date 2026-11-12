import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../locales/he.json';
import { ErrorState } from '../ErrorState';

const classesOf = (element: Element) => element.className.split(' ');
// "אין חיבור לאינטרנט. כשהחיבור יחזור, אפשר לנסות שוב."
const OFFLINE =
  '\u05d0\u05d9\u05df \u05d7\u05d9\u05d1\u05d5\u05e8 \u05dc\u05d0\u05d9\u05e0\u05d8\u05e8\u05e0\u05d8. \u05db\u05e9\u05d4\u05d7\u05d9\u05d1\u05d5\u05e8 \u05d9\u05d7\u05d6\u05d5\u05e8, \u05d0\u05e4\u05e9\u05e8 \u05dc\u05e0\u05e1\u05d5\u05ea \u05e9\u05d5\u05d1.';
// "משהו השתבש" (the start of `common.error`)
const ERROR = /^\u05de\u05e9\u05d4\u05d5 \u05d4\u05e9\u05ea\u05d1\u05e9/;

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it('ac1_offline_vs_server_error', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const onRetry = vi.fn();
    const view = render(<ErrorState onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toHaveTextContent(OFFLINE);
    fireEvent.click(screen.getByRole('button'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByRole('alert').querySelector('p')).toHaveTextContent(ERROR);
    expect(screen.queryByText(OFFLINE)).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(onRetry).toHaveBeenCalledTimes(2);
    view.unmount();

    // The page variant's <h1> says offline too.
    onLine.mockReturnValue(false);
    render(<ErrorState page onRetry={onRetry} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(OFFLINE);
  });
});
