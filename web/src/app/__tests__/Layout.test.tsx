import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deferred, json, mockApi, renderRoutes } from '../../features/auth/__tests__/harness';
import he from '../../locales/he.json';
import { AppRoutes } from '../routes';

afterEach(() => {
  vi.unstubAllGlobals();
});

const classesOf = (el: Element | null | undefined) =>
  (el?.getAttribute('class') ?? '').split(/\s+/);

describe('Layout', () => {
  it('ac3_full_width_shell', async () => {
    mockApi({ 'GET /me': [json({ detail: 'unauthenticated' }, 401)], 'GET /areas': [json([])] });
    const view = renderRoutes('/login', <AppRoutes />);
    await screen.findByRole('heading', { level: 1, name: he.auth.login.title });

    // The header spans the page; its one child is the wide container holding the row and tagline.
    const header = document.querySelector('header');
    expect(header).not.toBeNull();
    const inner = header?.children ?? [];
    expect(inner).toHaveLength(1);
    expect(classesOf(inner[0])).toContain('max-w-wide');
    expect(inner[0]?.querySelector('a[href="/"]')).not.toBeNull();
    expect(inner[0]?.textContent).toContain(he.app.tagline);

    // <main> spans the page too: no width or padding of its own; its child is the page's container.
    const main = document.querySelector('main');
    expect(main).not.toBeNull();
    for (const c of classesOf(main)) {
      expect(c).not.toMatch(/^(max-w-|px-|ps-|pe-)/);
    }
    expect(main?.children).toHaveLength(1);
    const page = main?.firstElementChild;
    expect(classesOf(page)).toContain('max-w-narrow');
    expect(page?.contains(screen.getByRole('heading', { level: 1 }))).toBe(true);

    expect(document.querySelector('.max-w-\\[640px\\]')).toBeNull();
    view.unmount();
    vi.unstubAllGlobals();

    // A protected route while /me is pending: the guard's skeleton sits in the default column.
    const me = deferred();
    mockApi({ 'GET /me': [me.promise] });
    renderRoutes('/me/listings', <AppRoutes />);
    const skeleton = await vi.waitFor(() => {
      const el = document.querySelector('main [data-testid="skeleton"]');
      expect(el).not.toBeNull();
      return el as Element;
    });
    const column = skeleton.closest('.max-w-page');
    expect(column).not.toBeNull();
    expect(column?.parentElement?.tagName).toBe('MAIN');
  });
});
