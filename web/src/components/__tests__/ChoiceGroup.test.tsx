import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import he from '../../locales/he.json';
import { ChoiceGroup, choiceSegment } from '../ChoiceGroup';

const options = [
  { value: 'single', label: he.profile.household.single },
  { value: 'couple', label: he.profile.household.couple },
] as const;

const classesOf = (element: Element) => element.className.split(' ');

describe('ChoiceGroup', () => {
  it('ac5_error_marks_radios', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ChoiceGroup
        legend={he.profile.fields.household}
        name="household"
        options={options}
        value={null}
        onChange={onChange}
      />,
    );
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    for (const radio of radios) expect(radio).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).toBeNull();

    // A label carries the exported segment classes: brand tokens, accent when checked.
    const label = screen.getByText(options[0].label);
    expect(label.className).toBe(choiceSegment);
    expect(classesOf(label)).toEqual(
      expect.arrayContaining([
        'border-border-strong',
        'bg-surface',
        'text-ink',
        'peer-checked:border-accent',
        'peer-checked:bg-accent-soft',
        'peer-checked:text-accent-strong',
        'peer-aria-[invalid=true]:border-danger',
      ]),
    );
    fireEvent.click(label);
    expect(onChange).toHaveBeenCalledWith('single');

    // With an error, every radio is invalid and described by the alert.
    rerender(
      <ChoiceGroup
        legend={he.profile.fields.household}
        name="household"
        options={options}
        value="couple"
        onChange={onChange}
        error={he.listings.errors.required}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(he.listings.errors.required);
    expect(classesOf(alert)).toContain('text-danger');
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-invalid', 'true');
      expect(radio).toHaveAttribute('aria-describedby', alert.id);
    }
    expect(screen.getByRole('radio', { name: options[1].label })).toBeChecked();
  });

  it('ac14_stacked', () => {
    const props = {
      legend: he.profile.fields.household,
      name: 'household',
      options,
      value: null,
      onChange: vi.fn(),
    };
    const { rerender } = render(<ChoiceGroup {...props} stacked />);
    const label = screen.getByText(options[0].label);
    const option = label.parentElement as HTMLElement;
    const row = option.parentElement as HTMLElement;
    expect(classesOf(row)).toEqual(expect.arrayContaining(['flex', 'flex-col', 'gap-2']));
    expect(classesOf(option)).toEqual(['flex']);
    expect(classesOf(label)).toEqual(expect.arrayContaining(['justify-start', 'text-start']));
    expect(classesOf(label)).not.toContain('justify-center');
    expect(classesOf(label)).not.toContain('text-center');

    // Without it, every class is as before.
    rerender(<ChoiceGroup {...props} />);
    const plain = screen.getByText(options[0].label);
    expect(plain.className).toBe(choiceSegment);
    expect(classesOf(plain)).toEqual(expect.arrayContaining(['justify-center', 'text-center']));
    expect(plain.parentElement?.className).toBe('flex flex-1');
    expect(plain.parentElement?.parentElement?.className).toBe('flex gap-2');
  });
});
