import { QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { json, mockApi, testQueryClient } from '../../auth/__tests__/harness';
import { gushDan } from '../../listings/__tests__/fixtures';
import { areasQuery } from '../api';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Every source file but this feature's own API module: none may fetch the areas by itself.
const sources = import.meta.glob<string>(['../../../**/*.{ts,tsx}', '!**/__tests__/**'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('areasQuery', () => {
  it('nf1_cached', async () => {
    // Every call site goes through `areasQuery` (wizard, profile, people pages, picker).
    const callers = Object.entries(sources)
      .filter(([path, text]) => path !== '../api.ts' && /\bfetchAreas\b/.test(text))
      .map(([path]) => path);
    expect(callers).toEqual([]);
    expect(Object.keys(sources)).toContain('../../listings/ListingWizard.tsx');

    // One request, also after 10 minutes with no area screen mounted.
    const api = mockApi({ 'GET /areas': [json([gushDan])] });
    const client = testQueryClient();
    const mount = () => {
      const observer = new QueryObserver(client, areasQuery);
      return observer.subscribe(() => undefined);
    };
    const unsubscribe = mount();
    await vi.waitFor(() => {
      expect(client.getQueryData(areasQuery.queryKey)).toEqual([gushDan]);
    });
    unsubscribe();

    vi.useFakeTimers();
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(client.getQueryData(areasQuery.queryKey)).toEqual([gushDan]);
    const again = mount();
    await vi.advanceTimersByTimeAsync(10);
    again();
    expect(api.calls('GET /areas')).toHaveLength(1);

    // An explicit refetch still goes out.
    await client.invalidateQueries({ queryKey: areasQuery.queryKey, refetchType: 'all' });
    expect(api.calls('GET /areas')).toHaveLength(2);
  });
});
