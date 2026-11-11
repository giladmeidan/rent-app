import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { json, mockApi } from '../../auth/__tests__/harness';
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
});
