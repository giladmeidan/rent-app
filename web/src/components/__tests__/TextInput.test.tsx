import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { Field } from '../Field';
import { TextInput } from '../TextInput';

describe('TextInput', () => {
  it('ac4_text_input', () => {
    // Standalone: its own id, invalid and aria-describedby; start / end adornments; the ref.
    const ref = createRef<HTMLInputElement>();
    const { unmount } = render(
      <TextInput
        ref={ref}
        id="price"
        invalid
        aria-describedby="note"
        aria-label={he.listings.fields.price}
        start={he.listings.units.ils}
        end={he.listings.units.perMonth}
      />,
    );
    const input = screen.getByRole('textbox', { name: he.listings.fields.price });
    expect(ref.current).toBe(input);
    expect(input).toHaveAttribute('id', 'price');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'note');
    const box = input.parentElement as HTMLElement;
    expect(box.firstElementChild).toHaveTextContent(he.listings.units.ils);
    expect(box.lastElementChild).toHaveTextContent(he.listings.units.perMonth);
    expect(box.firstElementChild).toHaveClass('shrink-0', 'text-body-sm');
    expect(box).toHaveClass(
      'flex',
      'items-center',
      'rounded-md',
      'border',
      'min-h-12',
      'border-danger',
      'bg-surface',
      'focus-within:ring-2',
      'focus-within:ring-accent-soft',
    );
    expect(box).not.toHaveClass('border-border-strong');
    expect(input).toHaveClass('text-body');
    expect(input).not.toHaveClass('text-h3');
    // The input fills the box's height, so a click on the box's padding lands in it.
    expect(input).toHaveClass('flex-1', 'self-stretch');
    // The adornments stay out of the name.
    expect(input).toHaveAccessibleName(he.listings.fields.price);
    unmount();

    // md, valid, enabled: border-strong with the accent focus border; no aria-invalid.
    const plain = render(<TextInput aria-label={he.listings.fields.city} />);
    const valid = screen.getByRole('textbox');
    expect(valid).not.toHaveAttribute('aria-invalid');
    expect(valid).not.toHaveAttribute('aria-describedby');
    expect(valid.parentElement).toHaveClass('border-border-strong', 'focus-within:border-accent');
    plain.unmount();

    // Disabled: surface-subtle, not surface.
    const disabled = render(
      <Field label={he.listings.fields.arnona}>
        <TextInput disabled />
      </Field>,
    );
    const off = screen.getByRole('textbox', { name: he.listings.fields.arnona });
    expect(off).toBeDisabled();
    expect(off.parentElement).toHaveClass('bg-surface-subtle', 'opacity-60');
    expect(off.parentElement).not.toHaveClass('bg-surface');
    disabled.unmount();

    // lg: 52px box, h3 text and not body, label-size adornments.
    render(
      <Field label={he.listings.fields.price}>
        <TextInput size="lg" end={he.listings.units.ils} />
      </Field>,
    );
    const large = screen.getByRole('textbox', { name: he.listings.fields.price });
    expect(large).toHaveClass('text-h3');
    expect(large).not.toHaveClass('text-body');
    expect(large.parentElement).toHaveClass('min-h-13');
    expect(large.parentElement).not.toHaveClass('min-h-12');
    expect(large.parentElement?.lastElementChild).toHaveClass('text-label');
  });
});
