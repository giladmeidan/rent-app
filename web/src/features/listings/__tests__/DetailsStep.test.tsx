import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { currentPath, json, mockApi, testQueryClient } from '../../auth/__tests__/harness';
import { gushDan, listing } from './fixtures';
import {
  areasLoaded,
  change,
  chooseApartmentAndContinue,
  chooseTypeAndContinue,
  errorFor,
  field,
  fillValidDetails,
  nextButton,
  progress,
  renderWizard,
  toPreferences,
} from './wizard';
import { FIELD_ORDER } from '../validate';

afterEach(() => {
  vi.unstubAllGlobals();
});

const f = he.listings.fields;
const telAviv = { id: '00000000-0000-0000-0000-00000000a2a2', slug: 'tlv', name_he: 'תל אביב' };

describe('DetailsStep', () => {
  it('ac2_groups_keep_field_order', async () => {
    mockApi({ 'GET /areas': [json([gushDan])] });
    renderWizard();
    chooseApartmentAndContinue();
    await areasLoaded();

    // The five group headings, in order.
    const s = he.listings.section;
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      s.address,
      s.apartment,
      s.priceEntry,
      s.amenities,
      s.payments,
    ]);

    // The controls keep `FIELD_ORDER`'s order (the first invalid one gets the focus).
    const byId = (name: string) =>
      document.querySelector<HTMLElement>(`[id$="-${name}"]`) as HTMLElement;
    const order = FIELD_ORDER.slice(0, FIELD_ORDER.indexOf('description') + 1);
    const controls = order.map(byId);
    controls.forEach((control, i) => {
      expect(control, order[i]).toBeInTheDocument();
      const next = controls[i + 1];
      if (next !== undefined) {
        expect(
          control.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
          `${order[i] ?? ''} before ${order[i + 1] ?? ''}`,
        ).toBeTruthy();
      }
    });

    // The flexible switch follows the date input.
    const follows = (a: HTMLElement, b: HTMLElement) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const flexible = screen.getByRole('switch', { name: f.entryFlexible });
    expect(follows(field(f.availableFrom), flexible)).toBe(true);

    // The amenities card: elevator, parking, furnished, pets.
    const elevator = screen.getByRole('switch', { name: f.elevator });
    const card = elevator.closest('.divide-y') as HTMLElement;
    expect(card).toContainElement(field(f.parking));
    expect(card).not.toContainElement(flexible);
    const inCard = [
      elevator,
      field(f.parking),
      within(card).getByRole('group', { name: f.furnished }),
      screen.getByRole('switch', { name: f.pets }),
    ];
    inCard.forEach((control, i) => {
      expect(card).toContainElement(control);
      const next = inCard[i + 1];
      if (next !== undefined) expect(follows(control, next)).toBe(true);
    });

    // Floor 5 of 3: the one box reddens; each input names only its own alert (or none).
    change(f.floor, '5');
    change(f.totalFloors, '3');
    fireEvent.click(nextButton());
    const floor = field(f.floor);
    const total = field(f.totalFloors);
    expect(floor.parentElement).toHaveClass('border-danger');
    expect(total.parentElement).toBe(floor.parentElement);
    const alertOf = (input: HTMLElement) =>
      (input.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id))
        .filter((el) => el?.getAttribute('role') === 'alert');
    expect(alertOf(total)).toHaveLength(1);
    expect(alertOf(total)[0]).toHaveTextContent(he.listings.errors.floors);
    expect(alertOf(floor)).toHaveLength(0);
  });

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
    // The message sits in the EmptyState card; the alert is in the same field.
    expect(empty).toBeInTheDocument();
    expect(within(screen.getByTestId('area-field')).getByRole('alert')).toHaveTextContent(
      he.listings.errors.required,
    );
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
    expect(field(f.area)).not.toHaveAttribute('aria-invalid', 'true');
    expect(field(f.city)).toHaveFocus();
    expect(api.calls('POST /listings')).toHaveLength(0);
    expect(progress()).toHaveAttribute('aria-valuenow', '2');

    // Floor above the building's floors.
    change(f.floor, '3');
    change(f.totalFloors, '2');
    fireEvent.click(nextButton());
    expect(errorFor(field(f.totalFloors))).toHaveTextContent(he.listings.errors.floors);
    expect(field(f.floor)).not.toHaveAttribute('aria-invalid', 'true');

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
    expect(field(f.city)).not.toHaveAttribute('aria-invalid', 'true');
    change(f.street, 'כצנלסון');
    expect(field(f.street)).not.toHaveAttribute('aria-invalid', 'true');
    change(f.street, 'א'.repeat(81));
    expect(field(f.street)).not.toHaveAttribute('aria-invalid', 'true');
    fireEvent.blur(field(f.street));
    expect(errorFor(field(f.street))).toHaveTextContent(
      i18n.t('listings.errors.tooLong', { max: 80 }),
    );
    expect(api.calls('POST /listings')).toHaveLength(0);
  });

  it('ac3_entry_date_read_back', async () => {
    mockApi({ 'GET /areas': [json([gushDan])] });
    renderWizard();
    chooseApartmentAndContinue();
    await areasLoaded();
    const ids = () => (field(f.availableFrom).getAttribute('aria-describedby') ?? '').split(' ');

    // Empty and invalid: the error alone, no read-back.
    fireEvent.click(nextButton());
    const error = errorFor(field(f.availableFrom));
    expect(ids()).toEqual([error.id]);

    // A day: the read-back under the input.
    change(f.availableFrom, '2026-11-12');
    // "התאריך שנבחר: 12 בנובמבר 2026"
    const readback = screen.getByText(
      '\u05d4\u05ea\u05d0\u05e8\u05d9\u05da \u05e9\u05e0\u05d1\u05d7\u05e8: 12 \u05d1\u05e0\u05d5\u05d1\u05de\u05d1\u05e8 2026',
    );
    expect(ids()).toContain(readback.id);
    expect(
      field(f.availableFrom).compareDocumentPosition(readback) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // A real day out of range: the error id stays, next to the read-back's.
    change(f.availableFrom, '2099-01-01');
    fireEvent.click(nextButton());
    const rangeError = errorFor(field(f.availableFrom));
    expect(rangeError).toHaveTextContent(he.listings.errors.dateRange);
    // "התאריך שנבחר: 1 בינואר 2099"
    const later = screen.getByText(
      '\u05d4\u05ea\u05d0\u05e8\u05d9\u05da \u05e9\u05e0\u05d1\u05d7\u05e8: 1 \u05d1\u05d9\u05e0\u05d5\u05d0\u05e8 2099',
    );
    expect(ids()).toEqual([rangeError.id, later.id]);
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

  it('ac12 four optional apartment facts, after pets, sent as chosen', async () => {
    // Spec 0014b AC12.
    const r = he.listings.room;
    const facts = [r.balcony, f.safeRoom, f.airConditioning, f.condition];
    const group = (legend: string) => screen.getByRole('group', { name: legend });
    const choice = (legend: string, name: string) =>
      within(group(legend)).getByRole('radio', { name });
    const api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json(listing(), 201)],
      'GET /me/listings': [json([])],
    });
    const view = renderWizard();
    chooseApartmentAndContinue();
    await areasLoaded();
    fillValidDetails();

    // In the amenities card, after pets, in order; every one starts at "not said".
    const pets = screen.getByRole('switch', { name: f.pets });
    const card = pets.closest('.divide-y') as HTMLElement;
    const groups = facts.map(group);
    [pets, ...groups].forEach((control, i) => {
      expect(card).toContainElement(control);
      const next = groups[i];
      if (next !== undefined) {
        expect(
          control.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    });
    for (const legend of facts) expect(choice(legend, r.unset)).toBeChecked();
    for (const legend of [r.balcony, f.safeRoom, f.airConditioning]) {
      expect(
        within(group(legend))
          .getAllByRole('radio')
          .map((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent),
      ).toEqual([he.common.yes, he.common.no, r.unset]);
    }
    const cond = he.listings.condition;
    expect(
      within(group(f.condition))
        .getAllByRole('radio')
        .map((radio) => (radio as HTMLInputElement).labels?.[0]?.textContent),
    ).toEqual([cond.new, cond.renovated, cond.good, cond.needsWork, r.unset]);

    // Optional: the step moves on with none answered; a balcony and a condition are sent, the
    // other two as `null`.
    fireEvent.click(choice(r.balcony, he.common.yes));
    fireEvent.click(choice(f.condition, cond.renovated));
    fireEvent.click(choice(f.safeRoom, he.common.no));
    fireEvent.click(choice(f.safeRoom, r.unset));
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    fireEvent.click(screen.getByRole('button', { name: he.listings.publish }));
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    expect(api.calls('POST /listings')[0]?.body).toMatchObject({
      balcony: true,
      safe_room: null,
      air_conditioning: null,
      condition: 'renovated',
    });
    view.unmount();
    vi.unstubAllGlobals();

    // A room: none of the three on the details step, and its balcony only in `RoomFields`.
    mockApi({ 'GET /areas': [json([gushDan])] });
    await toPreferences(testQueryClient(), 'room');
    for (const legend of [f.safeRoom, f.airConditioning, f.condition]) {
      expect(screen.queryByRole('group', { name: legend })).toBeNull();
    }
    expect(screen.getAllByRole('group', { name: r.balcony })).toHaveLength(1);
    expect(screen.getByRole('region', { name: r.title })).toContainElement(group(r.balcony));
    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
    fireEvent.click(screen.getByRole('button', { name: he.common.back }));
    expect(progress()).toHaveAttribute('aria-valuenow', '2');
    expect(screen.queryByRole('group', { name: r.balcony })).toBeNull();
  });
});
