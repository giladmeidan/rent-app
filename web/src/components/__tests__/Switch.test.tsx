import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import he from '../../locales/he.json';
import { Switch } from '../Switch';

const label = he.listings.fields.entryFlexible;

function Controlled({ onChange }: { onChange: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <Switch
      label={label}
      checked={checked}
      onChange={(next) => {
        setChecked(next);
        onChange(next);
      }}
    />
  );
}

describe('Switch', () => {
  it('ac5_switch_toggles', () => {
    const onChange = vi.fn();
    const { container } = render(<Controlled onChange={onChange} />);
    const control = screen.getByRole('switch', { name: label });
    expect(control).not.toBeChecked();

    fireEvent.click(screen.getByText(label));
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(control).toBeChecked();
    fireEvent.click(screen.getByText(label));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(control).not.toBeChecked();

    // Brand tokens: the track, the thumb and the label.
    expect(container.querySelector('.bg-border-strong.peer-checked\\:bg-accent')).not.toBeNull();
    expect(container.querySelector('.bg-surface.shadow-thumb')).not.toBeNull();
    expect(screen.getByText(label).className.split(' ')).toContain('text-body');
  });
});
