import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useIsDesktop, useMediaQuery } from '../useMediaQuery';

/** A `matchMedia` stub whose lists all follow one `matches` flag, flipped by `set()`. */
function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const queries: string[] = [];
  const matchMedia = vi.fn((query: string) => {
    queries.push(query);
    return {
      get matches() {
        return matches;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    } as unknown as MediaQueryList;
  });
  vi.stubGlobal('matchMedia', matchMedia);
  return {
    queries,
    listeners,
    set(next: boolean) {
      matches = next;
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMediaQuery', () => {
  it('ac3_media_query', () => {
    // Without matchMedia (jsdom): false, the phone layout.
    vi.stubGlobal('matchMedia', undefined);
    expect(renderHook(() => useMediaQuery('(min-width: 1024px)')).result.current).toBe(false);

    // It follows a stubbed `change` event, and unsubscribes on unmount.
    const media = stubMatchMedia(false);
    const { result, unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(false);
    act(() => media.set(true));
    expect(result.current).toBe(true);
    act(() => media.set(false));
    expect(result.current).toBe(false);
    expect(media.queries).toContain('(min-width: 768px)');
    unmount();
    expect(media.listeners.size).toBe(0);

    // useIsDesktop queries Tailwind's lg.
    const desktop = stubMatchMedia(true);
    expect(renderHook(() => useIsDesktop()).result.current).toBe(true);
    expect(new Set(desktop.queries)).toEqual(new Set(['(min-width: 1024px)']));
  });
});
