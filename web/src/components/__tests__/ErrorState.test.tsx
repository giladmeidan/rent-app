import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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

  it('ac2_retry_success_keeps_focus_in_main', async () => {
    // A box inside <main id="main">: the retry is focused and clicked, and the retry's success
    // unmounts the box. Focus lands on <main>, not <body>.
    function Page() {
      const [failed, setFailed] = useState(true);
      return (
        <main id="main" tabIndex={-1}>
          <input aria-label="field" />
          {failed && <ErrorState onRetry={() => setFailed(false)} />}
        </main>
      );
    }
    const view = render(<Page />);
    const retry = screen.getByRole('button', { name: he.common.retry });
    act(() => retry.focus());
    expect(retry).toHaveFocus();
    fireEvent.click(retry);
    expect(screen.queryByRole('alert')).toBeNull();
    await vi.waitFor(() => {
      expect(screen.getByRole('main')).toHaveFocus();
    });
    view.unmount();

    // A box that unmounts while focus is in another field leaves focus there.
    function Typing() {
      const [failed, setFailed] = useState(true);
      return (
        <main id="main" tabIndex={-1}>
          <input aria-label="field" onChange={() => setFailed(false)} />
          {failed && <ErrorState onRetry={() => undefined} />}
        </main>
      );
    }
    render(<Typing />);
    const field = screen.getByRole('textbox', { name: 'field' });
    act(() => field.focus());
    fireEvent.change(field, { target: { value: 'x' } });
    expect(screen.queryByRole('alert')).toBeNull();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    expect(field).toHaveFocus();
  });
});
