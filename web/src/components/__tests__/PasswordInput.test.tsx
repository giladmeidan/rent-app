import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { Field } from '../Field';
import { PasswordInput } from '../PasswordInput';

describe('PasswordInput', () => {
  it('ac16_toggle_names_its_action_and_controls_the_input', () => {
    // Spec 0016a: LTR, wired by the surrounding Field; the toggle's name changes with the state.
    const ref = createRef<HTMLInputElement>();
    render(
      <Field label={he.auth.password.label} hint={he.auth.password.hint}>
        <PasswordInput ref={ref} autoComplete="current-password" />
      </Field>,
    );
    const input = screen.getByLabelText(he.auth.password.label);
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute('type', 'password');
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(input).toHaveAccessibleDescription(he.auth.password.hint);
    const toggle = screen.getByRole('button', { name: he.auth.password.show });
    expect(toggle).toHaveAttribute('type', 'button');
    expect(toggle).toHaveAttribute('aria-controls', input.id);

    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(toggle).toHaveAccessibleName(he.auth.password.hide);

    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'password');
    expect(toggle).toHaveAccessibleName(he.auth.password.show);
  });

  it('standalone_uses_its_own_id', () => {
    render(<PasswordInput id="pw" aria-label={he.auth.password.label} />);
    expect(screen.getByRole('button', { name: he.auth.password.show })).toHaveAttribute(
      'aria-controls',
      'pw',
    );
    expect(screen.getByLabelText(he.auth.password.label)).toHaveAttribute('id', 'pw');
  });
});
