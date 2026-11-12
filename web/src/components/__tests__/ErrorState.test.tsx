import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorState } from '../ErrorState';

// "אין חיבור לאינטרנט. כשהחיבור יחזור, אפשר לנסות שוב."
const OFFLINE = 'אין חיבור לאינטרנט. כשהחיבור יחזור, אפשר לנסות שוב.';
// "משהו השתבש" (the start of `common.error`)
const ERROR = /^משהו השתבש/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorState', () => {
  it('ac1_offline_vs_server_error', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);

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
  });
});
