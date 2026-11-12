import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { currentPath, json, mockApi, testQueryClient } from '../../auth/__tests__/harness';
import { RoomFields } from '../RoomFields';
import { emptyForm, type ListingForm } from '../validate';
import { gushDan, listing } from './fixtures';
import { errorFor, nextButton, progress, toPreferences } from './wizard';

afterEach(() => {
  vi.unstubAllGlobals();
});

const r = he.listings.room;
const g = he.rooms.genderPreference;
const roomRegion = () => screen.getByRole('region', { name: r.title });
const genderGroup = () => screen.getByRole('group', { name: r.genderPreference });
const gender = (name: string) => within(genderGroup()).getByRole('radio', { name });
const count = () => screen.getByLabelText(r.flatmatesCount);
const agesGroup = () => screen.getByRole('group', { name: r.ages });
const slot = (n: number) => screen.getByLabelText(r.ageOf.replace('{{n}}', String(n)));
const slots = () => within(agesGroup()).getAllByRole('textbox');
const minContract = () => screen.getByLabelText(he.listings.prefs.minContract);
const back = () => fireEvent.click(screen.getByRole('button', { name: he.common.back }));
const publishButton = () => screen.getByRole('button', { name: he.listings.publish });
const roomChips = () =>
  within(screen.getByRole('list', { name: r.title }))
    .getAllByRole('listitem')
    .map((chip) => chip.textContent);
const rangeError = () => i18n.t('listings.errors.range', { min: 18, max: 99 });

/** One questionnaire answer, by the question's flat wording and the answer's label. */
function answer(key: 'cleanliness' | 'guests', n: '1' | '2' | '3') {
  const q = he.lifestyle[key];
  fireEvent.click(
    within(screen.getByRole('group', { name: q.question.flat })).getByRole('radio', {
      name: q.answer[n],
    }),
  );
}

/** The element ids in `element`'s `aria-describedby`, resolved. */
const describedBy = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby')?.split(' ') ?? []).map((id) =>
    document.getElementById(id),
  );

const invalid = (...fields: string[]) =>
  json({ detail: fields.map((f) => ({ loc: ['body', f], msg: 'bad', type: 'x' })) }, 422);

describe('RoomFields', () => {
  it('ac1_room_block_only_for_rooms', async () => {
    // An apartment: no room block, no room chips, and the body carries the defaults.
    let api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json(listing(), 201)],
      'GET /me/listings': [json([])],
    });
    let view = await toPreferences();
    expect(screen.getByRole('heading', { level: 2, name: he.listings.prefs.title })).toBeVisible();
    expect(screen.queryByRole('region', { name: r.title })).toBeNull();
    expect(screen.queryByText(r.privacyNote)).toBeNull();
    expect(screen.queryByLabelText(r.flatmatesCount)).toBeNull();
    expect(screen.queryByRole('region', { name: he.lifestyle.title.flat })).toBeNull();
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '4');
    expect(screen.queryByRole('list', { name: r.title })).toBeNull();
    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    expect(api.calls('POST /listings')).toHaveLength(1);
    const body: unknown = api.calls('POST /listings')[0]?.body;
    expect(body).toMatchObject({ listing_type: 'apartment', flatmates_count: null });
    expect(body).toHaveProperty('gender_preference', 'any');
    expect(body).toHaveProperty('flatmate_ages', []);
    expect(body).toHaveProperty('lifestyle', {});
    view.unmount();
    vi.unstubAllGlobals();

    // A room: its own step title, and after the minimum-contract select the room region holding
    // the privacy line, the gender radios, the count and the flat's questionnaire as an <h4>.
    api = mockApi({ 'GET /areas': [json([gushDan])] });
    view = await toPreferences(testQueryClient(), 'room');
    expect(
      screen.getByRole('heading', { level: 2, name: he.listings.prefs.titleRoom }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: he.listings.prefs.title })).toBeNull();
    const region = roomRegion();
    expect(
      minContract().compareDocumentPosition(region) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(region).getByRole('heading', { level: 3, name: r.title })).toBeVisible();
    expect(within(region).getByText(r.privacyNote)).toBeVisible();
    expect(within(region).getByText(r.genderHint)).toBeVisible();
    expect(region).toContainElement(genderGroup());
    const radios = within(genderGroup()).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    [g.women, g.men, g.any].forEach((name, i) => {
      expect(radios[i]).toHaveAccessibleName(name);
    });
    expect(gender(g.any)).toBeChecked();
    expect(gender(g.women)).not.toBeChecked();
    expect(region).toContainElement(count());
    expect(count()).toHaveValue('');
    expect(count()).toHaveDisplayValue(he.listings.fields.choose);
    expect(
      within(count())
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([he.listings.fields.choose, '1', '2', '3', '4', '5', '6', '7']);
    // No count yet: no age slots.
    expect(screen.queryByRole('group', { name: r.ages })).toBeNull();
    const lifestyle = within(region).getByRole('region', { name: he.lifestyle.title.flat });
    expect(
      within(lifestyle).getByRole('heading', { level: 4, name: he.lifestyle.title.flat }),
    ).toBeVisible();
    expect(
      within(lifestyle).getByRole('group', { name: he.lifestyle.cleanliness.question.flat }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { level: 3, name: he.lifestyle.title.flat })).toBeNull();

    // Switching to an apartment hides the block; switching back restores what was chosen.
    fireEvent.click(gender(g.women));
    fireEvent.change(count(), { target: { value: '2' } });
    back();
    back();
    fireEvent.click(screen.getByLabelText(he.listings.type.apartment));
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
    expect(screen.queryByRole('region', { name: r.title })).toBeNull();
    back();
    back();
    fireEvent.click(screen.getByLabelText(he.listings.type.room));
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    expect(gender(g.women)).toBeChecked();
    expect(count()).toHaveValue('2');
    view.unmount();
  });

  it('ac2_count_required_and_age_slots', async () => {
    const api = mockApi({ 'GET /areas': [json([gushDan])], 'POST /listings': [] });
    const view = await toPreferences(testQueryClient(), 'room');
    // Nothing is an error before step 3's "next".
    expect(screen.queryByRole('alert')).toBeNull();
    expect(count()).not.toHaveAttribute('aria-invalid', 'true');

    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
    expect(errorFor(count())).toHaveTextContent(he.listings.errors.required);
    const [hintEl, errorEl] = describedBy(count());
    expect(hintEl).toHaveTextContent(r.flatmatesHint);
    expect(errorEl).toHaveAttribute('role', 'alert');
    expect(document.activeElement).toBe(count());
    expect(api.calls('POST /listings')).toHaveLength(0);

    // Choosing a count removes the error and shows exactly that many slots.
    fireEvent.change(count(), { target: { value: '3' } });
    expect(count()).not.toHaveAttribute('aria-invalid', 'true');
    expect(describedBy(count())).toEqual([hintEl]);
    expect(screen.queryByText(he.listings.errors.required)).toBeNull();
    expect(slots()).toHaveLength(3);
    expect(slots()).toEqual([slot(1), slot(2), slot(3)]);
    for (const input of slots()) {
      expect(input).toHaveAttribute('type', 'text');
      expect(input).toHaveAttribute('inputmode', 'numeric');
      expect(input).toHaveValue('');
    }
    expect(describedBy(agesGroup())).toEqual([screen.getByText(r.agesHint)]);
    for (const input of slots()) expect(describedBy(input)).toEqual([screen.getByText(r.agesHint)]);

    // Slot 3 first; lowering the count hides it, raising it brings it back with its age.
    fireEvent.change(slot(3), { target: { value: '41' } });
    expect(slot(1)).toHaveValue('');
    expect(slot(2)).toHaveValue('');
    fireEvent.change(count(), { target: { value: '2' } });
    expect(slots()).toHaveLength(2);
    expect(screen.queryByLabelText(r.ageOf.replace('{{n}}', '3'))).toBeNull();
    fireEvent.change(count(), { target: { value: '3' } });
    expect(slots()).toHaveLength(3);
    expect(slot(3)).toHaveValue('41');
    // Back to no count: no slots.
    fireEvent.change(count(), { target: { value: '' } });
    expect(screen.queryByRole('group', { name: r.ages })).toBeNull();
    view.unmount();

    // Switching the type after an earlier step-3 pass starts the validation over: no error on
    // arriving at the room block, only after its own "next".
    mockApi({ 'GET /areas': [json([gushDan])] });
    await toPreferences();
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '4');
    back();
    back();
    back();
    fireEvent.click(screen.getByLabelText(he.listings.type.room));
    fireEvent.click(nextButton());
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(nextButton());
    expect(errorFor(count())).toHaveTextContent(he.listings.errors.required);
    vi.unstubAllGlobals();
    cleanup();

    // The slot write itself: typing into slot 3 of an empty list leaves no hole.
    const onChange = vi.fn<(patch: Partial<ListingForm>) => void>();
    render(
      <RoomFields
        form={{ ...emptyForm, listing_type: 'room', flatmates_count: 3 }}
        onChange={onChange}
        errors={{}}
        fieldId={(name) => `f-${name}`}
      />,
    );
    fireEvent.change(slot(3), { target: { value: '41' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const ages = onChange.mock.calls[0]?.[0].flatmate_ages;
    expect(ages).toStrictEqual(['', '', '41']);
    expect(Object.keys(ages ?? [])).toEqual(['0', '1', '2']);
  });

  it('ac3_ages_validated', async () => {
    for (const bad of ['17', '100', '2x']) {
      mockApi({ 'GET /areas': [json([gushDan])] });
      const view = await toPreferences(testQueryClient(), 'room');
      fireEvent.change(count(), { target: { value: '3' } });
      fireEvent.change(slot(2), { target: { value: '30' } });
      fireEvent.change(slot(3), { target: { value: bad } });
      // A new error waits for "next".
      expect(screen.queryByRole('alert')).toBeNull();
      fireEvent.click(nextButton());

      expect(progress(), bad).toHaveAttribute('aria-valuenow', '3');
      expect(errorFor(agesGroup())).toHaveTextContent(rangeError());
      expect(describedBy(agesGroup())[0]).toHaveTextContent(r.agesHint);
      expect(slot(3)).toHaveAttribute('aria-invalid', 'true');
      // Empty and in-range slots are valid.
      expect(slot(1)).not.toHaveAttribute('aria-invalid', 'true');
      expect(slot(2)).not.toHaveAttribute('aria-invalid', 'true');
      expect(document.activeElement).toBe(slot(3));

      // Correcting it removes the error; then "next" moves on.
      fireEvent.change(slot(3), { target: { value: ' 35 ' } });
      expect(agesGroup()).toHaveAttribute('aria-invalid', 'false');
      expect(slot(3)).not.toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByText(rangeError())).toBeNull();
      fireEvent.click(nextButton());
      expect(progress(), bad).toHaveAttribute('aria-valuenow', '4');
      view.unmount();
      vi.unstubAllGlobals();
    }

    // Two invalid slots: focus on the first; fixing it leaves the error on the other.
    mockApi({ 'GET /areas': [json([gushDan])] });
    await toPreferences(testQueryClient(), 'room');
    fireEvent.change(count(), { target: { value: '3' } });
    fireEvent.change(slot(1), { target: { value: '17' } });
    fireEvent.change(slot(3), { target: { value: '100' } });
    fireEvent.click(nextButton());
    expect(document.activeElement).toBe(slot(1));
    expect(slot(1)).toHaveAttribute('aria-invalid', 'true');
    expect(slot(3)).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(slot(1), { target: { value: '18' } });
    expect(errorFor(agesGroup())).toHaveTextContent(rangeError());
    expect(slot(1)).not.toHaveAttribute('aria-invalid', 'true');
    expect(slot(3)).toHaveAttribute('aria-invalid', 'true');
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '3');
    expect(document.activeElement).toBe(slot(3));
  });

  it('ac4_room_fields_previewed_and_sent', async () => {
    let api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json(listing(), 201)],
      'GET /me/listings': [json([])],
    });
    let view = await toPreferences(testQueryClient(), 'room');
    fireEvent.click(gender(g.women));
    fireEvent.change(count(), { target: { value: '2' } });
    fireEvent.change(slot(1), { target: { value: '30' } });
    fireEvent.change(slot(2), { target: { value: '27' } });
    answer('cleanliness', '3');
    fireEvent.click(nextButton());
    expect(progress()).toHaveAttribute('aria-valuenow', '4');

    const list = screen.getByRole('list', { name: r.title });
    const card = screen.getByRole('article');
    expect(card.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(roomChips()).toEqual([
      'לנשים בלבד',
      '2 שותפים בדירה (27, 30)',
      'שאלון הדירה: 1 מתוך 7 תשובות',
    ]);
    // Ages or answers shown: the privacy note follows the chips' card.
    expect(list.parentElement?.nextElementSibling).toHaveTextContent(r.privacyNote);

    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    expect(api.calls('POST /listings')).toHaveLength(1);
    let body: unknown = api.calls('POST /listings')[0]?.body;
    expect(body).toMatchObject({
      listing_type: 'room',
      gender_preference: 'women',
      flatmates_count: 2,
      flatmate_ages: [27, 30],
    });
    expect(body).toHaveProperty('lifestyle', { cleanliness: 3 });
    view.unmount();
    vi.unstubAllGlobals();

    // Ages left empty, "לא משנה": no "for" chip, no questionnaire chip.
    api = mockApi({
      'GET /areas': [json([gushDan])],
      'POST /listings': [json(listing(), 201)],
      'GET /me/listings': [json([])],
    });
    view = await toPreferences(testQueryClient(), 'room');
    fireEvent.change(count(), { target: { value: '2' } });
    fireEvent.click(nextButton());
    expect(roomChips()).toEqual(['2 שותפים בדירה']);
    expect(screen.queryByText(/בלבד/)).toBeNull();
    // A bare count: no note.
    expect(screen.queryByText(r.privacyNote)).toBeNull();

    // One flatmate, without and with an age.
    back();
    fireEvent.change(count(), { target: { value: '1' } });
    fireEvent.click(nextButton());
    expect(roomChips()).toEqual([i18n.t('listings.roomPreview.flatmates', { count: 1 })]);
    back();
    fireEvent.change(slot(1), { target: { value: '45' } });
    fireEvent.click(nextButton());
    expect(roomChips()).toEqual([
      i18n.t('listings.roomPreview.flatmatesAges', { count: 1, ages: '45' }),
    ]);
    expect(screen.getByText(r.privacyNote)).toBeInTheDocument();
    back();
    fireEvent.change(slot(1), { target: { value: '' } });
    fireEvent.change(count(), { target: { value: '2' } });
    fireEvent.click(nextButton());

    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(currentPath()).toBe('/me/listings');
    });
    expect(api.calls('POST /listings')).toHaveLength(1);
    body = api.calls('POST /listings')[0]?.body;
    expect(body).toMatchObject({ gender_preference: 'any', flatmates_count: 2 });
    expect(body).toHaveProperty('flatmate_ages', []);
    expect(body).toHaveProperty('lifestyle', {});
    view.unmount();
  });

  it('ac5_server_error_returns_to_step_3', async () => {
    // The count named: back on step 3, the error on the select and focus there.
    mockApi({ 'GET /areas': [json([gushDan])], 'POST /listings': [invalid('flatmates_count')] });
    let view = await toPreferences(testQueryClient(), 'room');
    fireEvent.change(count(), { target: { value: '2' } });
    fireEvent.click(nextButton());
    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(progress()).toHaveAttribute('aria-valuenow', '3');
    });
    expect(errorFor(count())).toHaveTextContent(he.listings.errors.invalid);
    expect(document.activeElement).toBe(count());
    expect(screen.queryByText('bad')).toBeNull();
    // Changing it clears the error.
    fireEvent.change(count(), { target: { value: '3' } });
    expect(count()).not.toHaveAttribute('aria-invalid', 'true');
    view.unmount();
    vi.unstubAllGlobals();

    // The ages named: back on step 3, the error on the ages group, focus on the first slot.
    mockApi({ 'GET /areas': [json([gushDan])], 'POST /listings': [invalid('flatmate_ages')] });
    view = await toPreferences(testQueryClient(), 'room');
    fireEvent.change(count(), { target: { value: '2' } });
    fireEvent.change(slot(1), { target: { value: '30' } });
    fireEvent.click(nextButton());
    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(progress()).toHaveAttribute('aria-valuenow', '3');
    });
    expect(errorFor(agesGroup())).toHaveTextContent(he.listings.errors.invalid);
    expect(document.activeElement).toBe(slot(1));
    fireEvent.change(slot(1), { target: { value: '31' } });
    expect(agesGroup()).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText(he.listings.errors.invalid)).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // A server error on the ages also goes when the count changes.
    mockApi({ 'GET /areas': [json([gushDan])], 'POST /listings': [invalid('flatmate_ages')] });
    view = await toPreferences(testQueryClient(), 'room');
    fireEvent.change(count(), { target: { value: '2' } });
    fireEvent.change(slot(1), { target: { value: '30' } });
    fireEvent.click(nextButton());
    fireEvent.click(publishButton());
    await vi.waitFor(() => {
      expect(progress()).toHaveAttribute('aria-valuenow', '3');
    });
    expect(errorFor(agesGroup())).toHaveTextContent(he.listings.errors.invalid);
    fireEvent.change(count(), { target: { value: '3' } });
    expect(agesGroup()).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText(he.listings.errors.invalid)).toBeNull();
    view.unmount();
  });
});
