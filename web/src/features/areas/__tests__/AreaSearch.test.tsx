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
const AREAS = [
  gushDan,
  kfarSaba,
  beerSheva,
  settlement('by', 'באר יעקב'),
  settlement('mh', 'מג׳דל שמס'),
  neighbourhood('n1', 'מרכז העיר', kfarSaba),
  neighbourhood('n2', 'מרכז העיר', beerSheva),
  neighbourhood('n3', 'פלורנטין', gushDan),
];
const byId = new Map(AREAS.map((area) => [area.id, area]));

function renderSearch(kinds: AreaOut['kind'][] = ['settlement', 'neighbourhood']) {
  mockApi({ 'GET /areas': [json(AREAS)] });
  const onPick = vi.fn();
  render(
    <QueryClientProvider client={testQueryClient()}>
      <AreaSearch label="אזור" kinds={kinds} onPick={onPick} />
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
