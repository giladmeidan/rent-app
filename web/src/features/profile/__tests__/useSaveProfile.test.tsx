import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { json, mockApi } from '../../auth/__tests__/harness';
import { MARKET_PEOPLE_KEY, PEOPLE_LIKES_KEY } from '../../people/useMarketPeople';
import { useSaveProfile } from '../useSaveProfile';
import { profile } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSaveProfile', () => {
  it('ac9_save_resets_listing_queries', async () => {
    mockApi({ 'PUT /me/profile': [json(profile())] });
    const queryClient = new QueryClient();
    queryClient.setQueryData(['listing', 'A'], { room_fit: true });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSaveProfile(), { wrapper });
    const body = { ...profile(), updated_at: undefined };
    delete body.updated_at;
    result.current.mutate(body);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(['listing', 'A'])).toBeUndefined();
  });

  it('ac15_save_marks_the_people_lists_stale', async () => {
    // A save can change the gender rule and the ticket: both people queries are invalidated.
    mockApi({ 'PUT /me/profile': [json(profile())] });
    const queryClient = new QueryClient();
    queryClient.setQueryData(MARKET_PEOPLE_KEY, { pages: [], pageParams: [] });
    queryClient.setQueryData(PEOPLE_LIKES_KEY, { liked_me: [], mine: [], matches: [] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSaveProfile(), { wrapper });
    result.current.mutate(profile());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryState(MARKET_PEOPLE_KEY)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(PEOPLE_LIKES_KEY)?.isInvalidated).toBe(true);
  });
});
