import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AreaOut } from '../../../api/client';
import i18n from '../../../app/i18n';
import he from '../../../locales/he.json';
import { json, mockApi, testQueryClient } from '../../auth/__tests__/harness';
import { gushDan } from '../../listings/__tests__/fixtures';
import { PlaceSearch } from '../PlaceSearch';

afterEach(() => {
  vi.unstubAllGlobals();
});

const haifa: AreaOut = {
  ...gushDan,
  id: 'haifa',
  slug: 's-4000',
  name_he: 'חיפה',
  centre: [34.99, 32.79],
};
const florentin: AreaOut = {
  ...gushDan,
  id: 'florentin',
  slug: 'n-florentin',
  name_he: 'פלורנטין',
  kind: 'neighbourhood',
  parent_id: gushDan.id,
  centre: [34.7686, 32.0578],
};

describe('PlaceSearch', () => {
  it('ac4_jump', async () => {
    mockApi({ 'GET /areas': [json([gushDan, haifa, florentin])] });
    const onJump = vi.fn();
    const onNotFound = vi.fn();
    render(
      <QueryClientProvider client={testQueryClient()}>
        <PlaceSearch onJump={onJump} onNotFound={onNotFound} />
      </QueryClientProvider>,
    );
    const box = await screen.findByRole('combobox', { name: he.search.map.placeLabel });

    // A city: its centre at zoom 13.
    fireEvent.change(box, { target: { value: 'חיפה' } });
    expect(onJump).toHaveBeenLastCalledWith({ center: [34.99, 32.79], zoom: 13 });
    // A neighbourhood, by its "<neighbourhood>, <city>" label: its centre at zoom 15.
    const label = i18n.t('areas.neighbourhoodOf', {
      neighbourhood: 'פלורנטין',
      city: gushDan.name_he,
    });
    fireEvent.change(box, { target: { value: label } });
    expect(onJump).toHaveBeenLastCalledWith({ center: [34.7686, 32.0578], zoom: 15 });
    expect(onJump).toHaveBeenCalledTimes(2);

    // Enter on a name not in the catalogue: the caller says so, the field shows no error.
    fireEvent.change(box, { target: { value: 'מקום שאינו קיים' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onNotFound).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(he.areas.notFound)).toBeNull();
    expect(onJump).toHaveBeenCalledTimes(2);
  });
});
