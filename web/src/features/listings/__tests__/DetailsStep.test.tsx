import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { json, mockApi } from '../../auth/__tests__/harness';
import { gushDan } from './fixtures';
import {
  areasLoaded,
  change,
  chooseApartmentAndContinue,
  chooseTypeAndContinue,
  errorFor,
  field,
  nextButton,
  progress,
  renderWizard,
} from './wizard';

afterEach(() => {
  vi.unstubAllGlobals();
});

const f = he.listings.fields;
const telAviv = { id: '00000000-0000-0000-0000-00000000a2a2', slug: 'tlv', name_he: 'תל אביב' };

describe('DetailsStep', () => {
  it('ac3_client_validation', async () => {
    // Two areas: the placeholder is selected.
    mockApi({ 'GET /areas': [json([gushDan, telAviv])] });
    let view = renderWizard();
    chooseApartmentAndContinue();
    await areasLoaded();
    expect(field(f.area)).toHaveValue('');
    expect(within(field(f.area)).getAllByRole('option')[0]).toHaveTextContent(f.choose);
    view.unmount();
    vi.unstubAllGlobals();

    // No areas: the empty state instead of the select, and "next" reports the area as required.
    let api = mockApi({ 'GET /areas': [json([])] });
    view = renderWizard();
    chooseApartmentAndContinue();
    const empty = await screen.findByText(he.areas.empty);
    expect(screen.queryByRole('combobox', { name: f.area })).toBeNull();
    fireEvent.click(nextButton());
    // The message sits in the EmptyState card; the alert is the card's sibling in the field.
    expect(
      within(empty.parentElement?.parentElement as HTMLElement).getByRole('alert'),
    ).toHaveTextContent(he.listings.errors.required);
    view.unmount();
    vi.unstubAllGlobals();

    // One area: preselected. "next" with everything else empty.
    api = mockApi({ 'GET /areas': [json([gushDan])] });
    renderWizard();
    chooseApartmentAndContinue();
    await areasLoaded();
    expect(field(f.area)).toHaveValue(gushDan.id);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);

    fireEvent.click(nextButton());
    for (const label of [f.city, f.street, f.rooms, f.floor, f.size, f.price, f.availableFrom]) {
      expect(errorFor(field(label)), label).toHaveTextContent(he.listings.errors.required);
    }
    expect(field(f.area)).toHaveAttribute('aria-invalid', 'false');
    expect(field(f.city)).toHaveFocus();
    expect(api.calls('POST /listings')).toHaveLength(0);
    expect(progress()).toHaveAttribute('aria-valuenow', '2');

    // Floor above the building's floors.
    change(f.floor, '3');
    change(f.totalFloors, '2');
    fireEvent.click(nextButton());
    expect(errorFor(field(f.totalFloors))).toHaveTextContent(he.listings.errors.floors);
    expect(field(f.floor)).toHaveAttribute('aria-invalid', 'false');

    // Price below the range.
    change(f.price, '100');
    fireEvent.click(nextButton());
    expect(errorFor(field(f.price))).toHaveTextContent(
      i18n.t('listings.errors.range', { min: 500, max: 100000 }),
    );

    // City too long (41 code points).
    change(f.city, 'א'.repeat(41));
    fireEvent.click(nextButton());
    expect(errorFor(field(f.city))).toHaveTextContent(
      i18n.t('listings.errors.tooLong', { max: 40 }),
    );
    expect(field(f.city)).toHaveFocus();

    // After the first attempt: a fixed field's error goes at once (no layout jump on the next
    // click); a newly invalid field is reported on blur, not while typing.
    change(f.city, 'גבעתיים');
    expect(field(f.city)).toHaveAttribute('aria-invalid', 'false');
    change(f.street, 'כצנלסון');
    expect(field(f.street)).toHaveAttribute('aria-invalid', 'false');
    change(f.street, 'א'.repeat(81));
    expect(field(f.street)).toHaveAttribute('aria-invalid', 'false');
    fireEvent.blur(field(f.street));
    expect(errorFor(field(f.street))).toHaveTextContent(
      i18n.t('listings.errors.tooLong', { max: 80 }),
    );
    expect(api.calls('POST /listings')).toHaveLength(0);
  });

  it('ac4_furnished_choice_by_type', async () => {
    const choices = () =>
      within(screen.getByRole('group', { name: f.furnished }))
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent);
    for (const [type, labels] of [
      [
        he.listings.type.room,
        [
          '\u05dc\u05d0 \u05de\u05e8\u05d5\u05d4\u05d8',
          '\u05de\u05e8\u05d5\u05d4\u05d8 \u05d7\u05dc\u05e7\u05d9\u05ea',
          '\u05de\u05e8\u05d5\u05d4\u05d8',
        ],
      ],
      [
        he.listings.type.apartment,
        [
          '\u05dc\u05d0 \u05de\u05e8\u05d5\u05d4\u05d8\u05ea',
          '\u05de\u05e8\u05d5\u05d4\u05d8\u05ea \u05d7\u05dc\u05e7\u05d9\u05ea',
          '\u05de\u05e8\u05d5\u05d4\u05d8\u05ea',
        ],
      ],
    ] as const) {
      mockApi({ 'GET /areas': [json([gushDan])] });
      const view = renderWizard();
      chooseTypeAndContinue(type);
      await areasLoaded();
      expect(choices()).toEqual(labels);
      for (const label of labels) expect(screen.getByRole('radio', { name: label })).toBeVisible();
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('price_reentry_by_keyboard_selects_value', async () => {
    mockApi({ 'GET /areas': [json([gushDan])] });
    renderWizard();
    chooseApartmentAndContinue();
    await areasLoaded();
    const price = field(f.price) as HTMLInputElement;

    change(f.price, '7200');
    expect(price).toHaveValue('7,200');

    // Tab back in: the bare digits, all selected, so typing replaces them.
    act(() => {
      price.focus();
    });
    expect(price).toHaveValue('7200');
    expect([price.selectionStart, price.selectionEnd]).toEqual([0, 4]);

    act(() => {
      price.blur();
    });
    expect(price).toHaveValue('7,200');

    // A click places the caret itself: no forced selection.
    fireEvent.pointerDown(price);
    act(() => {
      price.focus();
    });
    expect(price).toHaveValue('7200');
    expect(price.selectionStart).toBe(price.selectionEnd);
  });
});
