import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import he from '../../locales/he.json';
import { ErrorState } from '../ErrorState';

describe('ErrorState', () => {
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
