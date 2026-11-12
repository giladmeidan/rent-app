import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { LIFESTYLE_KEYS, type LifestyleAnswers } from '../keys';
import { LifestyleFields } from '../LifestyleFields';

const questions = (perspective: 'seeker' | 'flat') =>
  LIFESTYLE_KEYS.map((key) => he.lifestyle[key].question[perspective]);
const group = (name: string) => screen.getByRole('group', { name });
const radio = (groupName: string, name: string) =>
  within(group(groupName)).getByRole<HTMLInputElement>('radio', { name });
const clearName = (question: string) => i18n.t('lifestyle.clearAria', { question });

/** The fields with their own state, reporting every `onChange` to `spy`, inside a form. */
function Controlled({
  initial,
  spy,
  onSubmit,
}: {
  initial: LifestyleAnswers;
  spy: (next: LifestyleAnswers) => void;
  onSubmit?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <LifestyleFields
        value={value}
        perspective="seeker"
        onChange={(next) => {
          spy(next);
          setValue(next);
        }}
      />
    </form>
  );
}

describe('LifestyleFields', () => {
  it('ac4_clear_row_reserved', () => {
    const spy = vi.fn();
    render(<Controlled initial={{ cleanliness: 2 }} spy={spy} />);
    const rows = () => screen.getAllByTestId('lifestyle-clear-row');
    // One row per question, answered or not; a "ניקוי" button only in the answered one.
    expect(rows()).toHaveLength(LIFESTYLE_KEYS.length);
    const clear = screen.getByRole('button', { name: clearName(questions('seeker')[0] ?? '') });
    expect(clear).toHaveTextContent(he.lifestyle.clear);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(rows()[0]).toContainElement(clear);
    const height = rows()[1]?.className;

    // Answering another question keeps every row in place and adds a button to that row only.
    fireEvent.click(radio(questions('seeker')[1] ?? '', he.lifestyle.guests.answer['1']));
    expect(rows()).toHaveLength(LIFESTYLE_KEYS.length);
    expect(within(rows()[1] as HTMLElement).getByRole('button')).toBeVisible();
    expect(rows()[1]?.className).toBe(height);

    // Clearing removes the button and keeps the row.
    fireEvent.click(clear);
    expect(rows()).toHaveLength(LIFESTYLE_KEYS.length);
    expect(within(rows()[0] as HTMLElement).queryByRole('button')).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('ac3_fields_both_perspectives_pick_and_clear', () => {
    // Seeker: the title (an h3 by default), the nudge, seven groups with three radios, none checked.
    let view = render(<LifestyleFields value={{}} onChange={() => {}} perspective="seeker" />);
    const heading = screen.getByRole('heading', { level: 3, name: he.lifestyle.title.seeker });
    expect(screen.getByRole('region', { name: he.lifestyle.title.seeker })).toContainElement(
      heading,
    );
    expect(screen.getByText(he.lifestyle.nudge)).toBeVisible();
    const groups = screen.getAllByRole('group');
    expect(groups.map((g) => g.querySelector('legend')?.textContent)).toEqual(questions('seeker'));
    for (const [i, key] of LIFESTYLE_KEYS.entries()) {
      const radios = within(groups[i] as HTMLElement).getAllByRole<HTMLInputElement>('radio');
      expect(radios.map((r) => r.labels?.[0]?.textContent)).toEqual([
        he.lifestyle[key].answer['1'],
        he.lifestyle[key].answer['2'],
        he.lifestyle[key].answer['3'],
      ]);
      for (const r of radios) {
        expect(r).not.toBeChecked();
        expect(r).toHaveAttribute('name', `lifestyle-${key}`);
      }
    }
    expect(screen.queryByRole('button')).toBeNull();
    view.unmount();

    // Flat: the flat title and the flat questions; `headingLevel={4}` gives an h4.
    view = render(
      <LifestyleFields value={{}} onChange={() => {}} perspective="flat" headingLevel={4} />,
    );
    expect(screen.getByRole('heading', { level: 4, name: he.lifestyle.title.flat })).toBeVisible();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    expect(screen.getAllByRole('group').map((g) => g.querySelector('legend')?.textContent)).toEqual(
      questions('flat'),
    );
    view.unmount();

    // A given value: those radios are checked, only those groups have a clear button.
    const fixed = vi.fn();
    view = render(
      <LifestyleFields value={{ night: 3, shabbat: 2 }} onChange={fixed} perspective="seeker" />,
    );
    const night = he.lifestyle.night.question.seeker;
    const shabbat = he.lifestyle.shabbat.question.seeker;
    for (const [i, key] of LIFESTYLE_KEYS.entries()) {
      const checked = within(screen.getAllByRole('group')[i] as HTMLElement)
        .getAllByRole<HTMLInputElement>('radio')
        .filter((r) => r.checked)
        .map((r) => r.value);
      expect(checked, key).toEqual(key === 'night' ? ['3'] : key === 'shabbat' ? ['2'] : []);
    }
    const clears = screen.getAllByRole('button', { name: /./ });
    expect(clears.map((b) => b.getAttribute('aria-label'))).toEqual([
      clearName(night),
      clearName(shabbat),
    ]);
    for (const b of clears) expect(b).toHaveTextContent(he.lifestyle.clear);
    fireEvent.click(screen.getByRole('button', { name: clearName(shabbat) }));
    expect(fixed).toHaveBeenLastCalledWith({ night: 3 });
    // Picking on top of a value keeps the other answers (a new object each time).
    fireEvent.click(
      radio(he.lifestyle.cleanliness.question.seeker, he.lifestyle.cleanliness.answer['1']),
    );
    expect(fixed).toHaveBeenLastCalledWith({ cleanliness: 1, night: 3, shabbat: 2 });
    view.unmount();

    // Controlled, inside a form: pick, pick another key, clear without submitting.
    const spy = vi.fn();
    const submit = vi.fn();
    render(<Controlled initial={{}} spy={spy} onSubmit={submit} />);
    const cleanliness = he.lifestyle.cleanliness.question.seeker;
    const kosher = he.lifestyle.kosher.question.seeker;
    fireEvent.click(radio(cleanliness, he.lifestyle.cleanliness.answer['3']));
    expect(spy).toHaveBeenLastCalledWith({ cleanliness: 3 });
    fireEvent.click(radio(kosher, he.lifestyle.kosher.answer['1']));
    expect(spy).toHaveBeenLastCalledWith({ cleanliness: 3, kosher: 1 });
    expect(radio(cleanliness, he.lifestyle.cleanliness.answer['3'])).toBeChecked();
    expect(radio(kosher, he.lifestyle.kosher.answer['1'])).toBeChecked();
    // Two answered groups, two clear buttons with distinct names; none on the others.
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      clearName(cleanliness),
      clearName(kosher),
    ]);
    const clear = screen.getByRole('button', { name: clearName(kosher) });
    expect(clear).toHaveAttribute('type', 'button');
    fireEvent.click(clear);
    expect(submit).not.toHaveBeenCalled();
    expect(spy).toHaveBeenLastCalledWith({ cleanliness: 3 });
    expect(Object.keys(spy.mock.lastCall?.[0] as object)).toEqual(['cleanliness']);
    for (const r of within(group(kosher)).getAllByRole('radio')) expect(r).not.toBeChecked();
    expect(screen.queryByRole('button', { name: clearName(kosher) })).toBeNull();
    // The button is gone; focus sits on the cleared group's first radio.
    expect(radio(kosher, he.lifestyle.kosher.answer['1'])).toHaveFocus();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
