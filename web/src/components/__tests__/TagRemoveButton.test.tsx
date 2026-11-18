import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import he from '../../locales/he.json';
import { TagRemoveButton } from '../TagRemoveButton';

describe('TagRemoveButton', () => {
  it('ac19_named_button_with_a_44px_hit_area', () => {
    const onClick = vi.fn();
    render(<TagRemoveButton aria-label={he.search.clear} onClick={onClick} />);
    const button = screen.getByRole('button', { name: he.search.clear });
    // Never submits the form around it.
    expect(button).toHaveAttribute('type', 'button');
    // 24 px, and 10 px more on each side for the press.
    expect(button).toHaveClass('size-6', 'after:absolute', 'after:-inset-2.5');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
