import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { Field } from '../Field';
import { Select } from '../Select';

const LABEL = he.listings.fields.furnished;

describe('Select', () => {
  it('ac4_select', () => {
    const ref = createRef<HTMLSelectElement>();
    const { container, unmount } = render(
      <Field label={LABEL} hint={he.listings.fields.optional} error={he.listings.errors.required}>
        <Select ref={ref} aria-describedby="own" className="w-40">
          <option value="none">{he.listings.furnished.none}</option>
        </Select>
      </Field>,
    );
    const select = screen.getByRole('combobox', { name: LABEL });
    expect(ref.current).toBe(select);
    expect(select.tagName).toBe('SELECT');
    expect(screen.getByText(LABEL)).toHaveAttribute('for', select.id);
    const hint = screen.getByText(he.listings.fields.optional);
    const error = screen.getByRole('alert');
    expect(select.getAttribute('aria-describedby')).toBe(`${hint.id} ${error.id} own`);
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveClass('border-danger', 'appearance-none', 'ps-3', 'pe-10', 'min-h-12');
    expect(select).not.toHaveClass('border-border-strong');
    // className is the wrapper's; the chevron sits at the inline end and lets clicks through.
    const wrapper = select.parentElement as HTMLElement;
    expect(wrapper).toHaveClass('relative', 'w-40');
    const chevron = container.querySelector('svg') as SVGElement;
    expect(chevron).toHaveAttribute('aria-hidden', 'true');
    expect(chevron).toHaveClass('pointer-events-none', 'absolute', 'end-3');
    expect(chevron.querySelector('path')).toHaveAttribute('d', 'M6 9l6 6 6-6');
    unmount();

    render(
      <Select aria-label={LABEL} id="own-id" disabled>
        <option value="none">{he.listings.furnished.none}</option>
      </Select>,
    );
    const own = screen.getByRole('combobox', { name: LABEL });
    expect(own).toHaveAttribute('id', 'own-id');
    expect(own).not.toHaveAttribute('aria-invalid');
    expect(own).toHaveClass('border-border-strong', 'focus:border-accent', 'bg-surface-subtle');
    expect(own).not.toHaveClass('bg-surface');
  });
});
