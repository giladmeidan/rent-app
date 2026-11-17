import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AreaOut } from '../../../api/client';
import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { json, mockApi, testQueryClient } from '../../auth/__tests__/harness';
import { gushDan } from '../../listings/__tests__/fixtures';
import { areaLabel } from '../areaLabel';
import { AreaSearch, normalise } from '../AreaSearch';

afterEach(() => {
  vi.unstubAllGlobals();
});

const settlement = (id: string, name_he: string): AreaOut => ({
  ...gushDan,
  id,
  slug: `s-${id}`,
  name_he,
});
const neighbourhood = (id: string, name_he: string, city: AreaOut): AreaOut => ({
  ...gushDan,
  id,
  slug: `n-${id}`,
  name_he,
  kind: 'neighbourhood',
  parent_id: city.id,
});
const kfarSaba = settlement('ks', 'כפר סבא');
const beerSheva = settlement('bs', 'באר שבע');
// A full name that is also the start of another label (the real catalogue has ~95 such pairs).
const azor = settlement('az', 'אזור');
const AREAS = [
  gushDan,
  kfarSaba,
  beerSheva,
  settlement('by', 'באר יעקב'),
  settlement('mh', 'מג׳דל שמס'),
  neighbourhood('n1', 'מרכז העיר', kfarSaba),
  neighbourhood('n2', 'מרכז העיר', beerSheva),
  neighbourhood('n3', 'פלורנטין', gushDan),
  azor,
  settlement('azt', 'אזור תעשייה הר-טוב'),
];
const byId = new Map(AREAS.map((area) => [area.id, area]));

function renderSearch(kinds: AreaOut['kind'][] = ['settlement', 'neighbourhood'], value?: string) {
  mockApi({ 'GET /areas': [json(AREAS)] });
  const onPick = vi.fn();
  render(
    <QueryClientProvider client={testQueryClient()}>
      <AreaSearch label="אזור" kinds={kinds} value={value} onPick={onPick} />
    </QueryClientProvider>,
  );
  return onPick;
}

describe('AreaSearch', () => {
  it('ac4_normalise_and_not_found', async () => {
    const t = i18n.t.bind(i18n);
    // A neighbourhood names its city; a settlement is its own name.
    expect(areaLabel(t, AREAS[5] as AreaOut, byId)).toBe('מרכז העיר, כפר סבא');
    expect(areaLabel(t, beerSheva, byId)).toBe('באר שבע');
    // No two labels are equal after `normalise`.
    const keys = AREAS.map((area) => normalise(areaLabel(t, area, byId)));
    expect(new Set(keys).size).toBe(keys.length);
    // Spaces around "-", runs of spaces, ASCII quotes for geresh / gershayim.
    expect(normalise('  תל  אביב -  יפו ')).toBe('תל אביב-יפו');
    expect(normalise("מג'דל שמס")).toBe('מג׳דל שמס');
    expect(normalise('ת"א')).toBe('ת״א');

    const onPick = renderSearch();
    await vi.waitFor(() => {
      expect(screen.getByLabelText('אזור')).not.toBeDisabled();
    });
    const input = screen.getByLabelText('אזור');

    // Odd spacing + Enter picks Tel Aviv-Yafo, and the input clears for the next chip.
    fireEvent.change(input, { target: { value: 'תל  אביב -יפו' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(gushDan);
    expect(input).toHaveValue('');

    // An unknown name + Enter: areas.notFound under the field, nothing picked; typing clears it.
    onPick.mockClear();
    fireEvent.change(input, { target: { value: 'אין כזה מקום' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(he.areas.notFound);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(input, { target: { value: 'אין' } });
    expect(screen.queryByRole('alert')).toBeNull();

    // A name another label starts with waits for Enter; a full one picks at once.
    fireEvent.change(input, { target: { value: 'באר' } });
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'מרכז העיר, באר שבע' } });
    expect(onPick).toHaveBeenCalledWith(AREAS[6]);
  });

  it('ac4_full_name_that_prefixes_another_picks_on_blur_enter_or_list', async () => {
    const onPick = renderSearch();
    await vi.waitFor(() => {
      expect(screen.getByLabelText('אזור')).not.toBeDisabled();
    });
    const input = screen.getByLabelText('אזור');
    // Typed: waits (another label starts with it), then leaving the field picks it.
    fireEvent.change(input, { target: { value: 'אזור' } });
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onPick).toHaveBeenCalledWith(azor);
    expect(input).toHaveValue('');
    // Chosen from the datalist: picks at once.
    onPick.mockClear();
    fireEvent.input(input, { target: { value: 'אזור' }, inputType: 'insertReplacementText' });
    expect(onPick).toHaveBeenCalledWith(azor);
  });

  it('ac4_wizard_enter_picks_a_full_name_that_prefixes_another', async () => {
    const onPick = renderSearch(['settlement'], '');
    await vi.waitFor(() => {
      expect(screen.getByLabelText('אזור')).not.toBeDisabled();
    });
    const input = screen.getByLabelText('אזור');
    fireEvent.change(input, { target: { value: 'אזור' } });
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(azor);
  });

  it('settlements only', async () => {
    renderSearch(['settlement']);
    await vi.waitFor(() => {
      expect(screen.getByLabelText('אזור')).not.toBeDisabled();
    });
    const input = screen.getByLabelText('אזור');
    const list = document.getElementById(input.getAttribute('list') ?? '');
    expect([...(list?.querySelectorAll('option') ?? [])].map((o) => o.value)).toEqual([
      'תל אביב-יפו',
      'כפר סבא',
      'באר שבע',
      'באר יעקב',
      'מג׳דל שמס',
      'אזור',
      'אזור תעשייה הר-טוב',
    ]);
  });

  it('error state retries', async () => {
    const api = mockApi({ 'GET /areas': [json({}, 500), json(AREAS)] });
    render(
      <QueryClientProvider client={testQueryClient()}>
        <AreaSearch label="אזור" kinds={['settlement']} onPick={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText('אזור')).toBeDisabled();
    fireEvent.click(await screen.findByRole('button', { name: he.common.retry }));
    await vi.waitFor(() => {
      expect(screen.getByLabelText('אזור')).not.toBeDisabled();
    });
    expect(api.calls('GET /areas')).toHaveLength(2);
  });
});
