import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { Field, useField } from '../Field';
import { TextInput } from '../TextInput';

const LABEL = he.listings.fields.street;
const HINT = he.listings.fields.streetHint;
const ERROR = he.listings.errors.required;

function Probe() {
  const field = useField();
  return <output data-testid="probe">{JSON.stringify(field)}</output>;
}

describe('Field', () => {
  it('ac4_field_wires_control', () => {
    const { unmount } = render(
      <Field label={LABEL} hint={HINT} error={ERROR} id="street">
        <TextInput id="ignored" aria-describedby="own" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: LABEL });
    const label = screen.getByText(LABEL);
    // The label's `for` is the input's id, and the context id wins over the input's own.
    expect(label.tagName).toBe('LABEL');
    expect(input).toHaveAttribute('id', 'street');
    expect(label).toHaveAttribute('for', 'street');
    // aria-describedby: the hint and the error, then the input's own.
    const hint = screen.getByText(HINT);
    const error = screen.getByRole('alert');
    expect(error).toHaveTextContent(ERROR);
    expect(input.getAttribute('aria-describedby')).toBe(`${hint.id} ${error.id} own`);
    expect(hint.id).toMatch(/-hint$/);
    expect(error.id).toMatch(/-error$/);
    expect(input).toHaveAccessibleDescription(`${HINT} ${ERROR}`);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    // The invalid box is red, not border-strong (a swap, not an append).
    const box = input.parentElement as HTMLElement;
    expect(box).toHaveClass('border-danger');
    expect(box).not.toHaveClass('border-border-strong');
    // Order: label, control, hint, error.
    const column = label.parentElement as HTMLElement;
    expect(column).toHaveClass('flex', 'flex-col', 'gap-1.5');
    expect([...column.children]).toEqual([label, box, hint, error]);
    unmount();

    // Without an error: no aria-invalid and no error node; a generated id; the hint alone.
    render(
      <Field label={LABEL} hint={HINT}>
        <TextInput />
      </Field>,
    );
    const valid = screen.getByRole('textbox', { name: LABEL });
    expect(valid).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(valid.id).toMatch(/-control$/);
    expect(valid.getAttribute('aria-describedby')).toBe(screen.getByText(HINT).id);
    expect(valid.parentElement).toHaveClass('border-border-strong');
    expect(valid.parentElement).not.toHaveClass('border-danger');
  });

  it('ac4_field_label_hidden_and_use_field', () => {
    render(
      <Field label={LABEL} error={ERROR} id="floor" labelHidden>
        <Probe />
      </Field>,
    );
    expect(screen.getByText(LABEL)).toHaveClass('sr-only');
    const context = JSON.parse(screen.getByTestId('probe').textContent ?? 'null') as {
      id: string;
      describedBy: string;
      invalid: boolean;
    };
    expect(context.id).toBe('floor');
    expect(context.invalid).toBe(true);
    expect(context.describedBy).toBe(screen.getByRole('alert').id);
  });

  it('ac4_use_field_outside_a_field_is_null', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('null');
  });
});
