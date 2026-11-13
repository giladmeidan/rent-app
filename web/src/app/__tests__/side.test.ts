import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setSide, sideOf, useSide, type Side } from '../side';

afterEach(() => {
  vi.restoreAllMocks();
});

/** `useSide` at `path`, re-rendered on every store change. */
function sideAt(path: string) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [path] }, children);
  return renderHook(() => useSide(), { wrapper });
}

describe('side', () => {
  it('ac5_side_of_paths_and_store', () => {
    const table: [string, Side | null][] = [
      // The market's paths.
      ['/market', 'market'],
      ['/market/mine', 'market'],
      ['/market?view=map', 'market'],
      ['/me/likes', 'market'],
      ['/me/flats', 'market'],
      ['/flatmates/join', 'market'],
      ['/me/listings/abc/people', 'market'],
      ['/me/listings/abc/flatmates', 'market'],
      // The apartments' paths; `/me/listings` is exact.
      ['/search', 'apartments'],
      ['/me/listings', 'apartments'],
      ['/me/applications', 'apartments'],
      // Shared.
      ['/', null],
      ['/listings/abc', null],
      ['/listings/new', null],
      ['/me/listings/abc', null],
      ['/me/listings/abc/edit', null],
      ['/me/listings/abc/applicants', null],
      ['/chat', null],
      ['/chat/abc', null],
      ['/me/profile', null],
      ['/login', null],
      ['/signup', null],
    ];
    for (const [path, side] of table) {
      // A pathname never carries the query; `?view=map` is checked as `useLocation` would give it.
      expect(sideOf(path.split('?')[0] ?? path), path).toBe(side);
    }

    // Empty storage: apartments on a shared path; a side path is its own side.
    expect(sideAt('/listings/abc').result.current).toBe('apartments');
    expect(sideAt('/market?view=map').result.current).toBe('market');

    // `setSide` stores the side and re-renders a subscriber on a shared path at once.
    const shared = sideAt('/chat');
    expect(shared.result.current).toBe('apartments');
    act(() => setSide('market'));
    expect(window.localStorage.getItem('homie.side')).toBe('market');
    expect(shared.result.current).toBe('market');
    // A side path still wins over the stored side.
    expect(sideAt('/search').result.current).toBe('apartments');
    act(() => setSide('apartments'));
    expect(shared.result.current).toBe('apartments');

    // A stored value that is not a side is none.
    window.localStorage.setItem('homie.side', 'house');
    expect(sideAt('/chat').result.current).toBe('apartments');

    // Storage that throws: reads fall back to apartments, writes are ignored.
    window.localStorage.setItem('homie.side', 'market');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(sideAt('/chat').result.current).toBe('apartments');
    expect(() => act(() => setSide('market'))).not.toThrow();
  });
});
