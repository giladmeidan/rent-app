import { useCallback, useSyncExternalStore } from 'react';

const hasMatchMedia = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/**
 * Whether `query` matches now, re-rendering on change. `false` where `matchMedia` is missing
 * (jsdom), so tests keep the phone layout.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  const getSnapshot = () => (hasMatchMedia() ? window.matchMedia(query).matches : false);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** The desktop switch: Tailwind's `lg` (1024px). */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

/** The side map's switch (spec 0009x): Tailwind's `xl` (1280px). */
export function useIsWide(): boolean {
  return useMediaQuery('(min-width: 1280px)');
}
