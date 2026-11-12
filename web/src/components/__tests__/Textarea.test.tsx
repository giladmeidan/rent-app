import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import he from '../../locales/he.json';
import { Field } from '../Field';
import { Textarea } from '../Textarea';

const LABEL = he.listings.fields.description;

describe('Textarea', () => {
  it('ac4_textarea', () => {
    const ref = createRef<HTMLTextAreaElement>();
    const { unmount } = render(
      <Field label={LABEL} hint={he.listings.fields.optional} error={he.listings.errors.required}>
        <Textarea ref={ref} id="ignored" aria-describedby="own" />
      </Field>,
    );
    const textarea = screen.getByRole('textbox', { name: LABEL });
    expect(ref.current).toBe(textarea);
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea).toHaveAttribute('rows', '4');
    expect(screen.getByText(LABEL)).toHaveAttribute('for', textarea.id);
    expect(textarea.id).toMatch(/-control$/);
    const hint = screen.getByText(he.listings.fields.optional);
    const error = screen.getByRole('alert');
    expect(textarea.getAttribute('aria-describedby')).toBe(`${hint.id} ${error.id} own`);
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveClass('border-danger', 'rounded-md', 'text-body', 'resize-y');
    expect(textarea).not.toHaveClass('border-border-strong');
    unmount();

    render(<Textarea aria-label={LABEL} rows={6} disabled />);
    const own = screen.getByRole('textbox', { name: LABEL });
    expect(own).toHaveAttribute('rows', '6');
    expect(own).not.toHaveAttribute('aria-invalid');
    expect(own).toHaveClass('border-border-strong', 'focus:border-accent', 'bg-surface-subtle');
    expect(own).not.toHaveClass('border-danger');
    expect(own).not.toHaveClass('bg-surface');
  });
});
