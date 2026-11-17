import * as Sentry from '@sentry/react';
import type { Breadcrumb, ErrorEvent } from '@sentry/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import he from '../../locales/he.json';
import { routePattern } from '../routePattern';
import { AppErrorBoundary, beforeBreadcrumb, beforeSend, initSentry } from '../sentry';

vi.mock('@sentry/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@sentry/react')>()),
  init: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.mocked(Sentry.init).mockClear();
});

const EMAIL = 'dana.levi@example.com';

describe('sentry', () => {
  it('ac7_off_without_dsn', () => {
    vi.stubEnv('VITE_SENTRY_DSN', '');
    initSentry();
    expect(Sentry.init).not.toHaveBeenCalled();

    // With a DSN: errors only, no PII, no replay integration added.
    vi.stubEnv('VITE_SENTRY_DSN', 'https://public@o0.ingest.de.sentry.io/1');
    initSentry();
    expect(Sentry.init).toHaveBeenCalledOnce();
    const options = vi.mocked(Sentry.init).mock.calls[0]?.[0];
    expect(options).toMatchObject({
      tracesSampleRate: 0,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        stackFrameVariables: false,
      },
    });
    expect(options?.integrations).toBeUndefined();
    expect(options?.beforeSend).toBe(beforeSend);
    expect(options?.beforeBreadcrumb).toBe(beforeBreadcrumb);
  });

  it('ac8_events_and_breadcrumbs_scrubbed', () => {
    expect(routePattern('/listings/abc')).toBe('/listings/:id');
    expect(routePattern('/me/listings/abc/edit')).toBe('/me/listings/:id/edit');
    expect(routePattern('/chat/abc')).toBe('/chat/:id');
    expect(routePattern('/')).toBe('/');
    expect(routePattern('/nope')).toBe('/*');
    expect(routePattern('/listings/new')).toBe('/listings/new');

    const event = beforeSend({
      type: undefined,
      message: `failed for ${EMAIL}`,
      request: {
        url: 'https://homie.test/listings/abc?budget=5000#x',
        headers: { Referer: 'https://homie.test/search?budget=5000', 'User-Agent': 'UA' },
      },
      user: { id: 'u1', email: EMAIL, ip_address: '1.2.3.4' },
      extra: { note: EMAIL },
      exception: { values: [{ type: 'Error', value: `cannot load ${EMAIL}` }] },
      breadcrumbs: [{ category: 'fetch', message: `failed for ${EMAIL}` }],
    } as ErrorEvent);
    expect(event.request).toEqual({ url: '/listings/:id' });
    expect(event.user).toBeUndefined();
    expect(event.extra).toBeUndefined();
    expect(event.message).toBe('failed for [email]');
    expect(event.exception?.values?.[0]?.value).toBe('cannot load [email]');
    expect(event.breadcrumbs?.[0]?.message).toBe('failed for [email]');
    expect(JSON.stringify(event)).not.toContain(EMAIL);

    expect(beforeBreadcrumb({ category: 'console', message: EMAIL })).toBeNull();
    expect(
      beforeBreadcrumb({
        category: 'ui.click',
        message: 'body > main > button[aria-label="דיווח על דנה לוי"]',
      }),
    ).toBeNull();
    expect(beforeBreadcrumb({ category: 'ui.input', message: 'input[name="email"]' })).toBeNull();
    const crumb = (b: Breadcrumb) => beforeBreadcrumb(b)?.data;
    expect(
      crumb({
        category: 'fetch',
        data: { url: 'http://api.test/listings?budget=5000', method: 'GET' },
      }),
    ).toEqual({ url: 'http://api.test/listings', method: 'GET' });
    expect(crumb({ category: 'xhr', data: { url: '/me/flats?token=abc#t' } })).toEqual({
      url: '/me/flats',
    });
    expect(
      crumb({
        category: 'navigation',
        data: { from: '/search?budget=5000', to: '/flatmates/join?token=secret#t=secret' },
      }),
    ).toEqual({ from: '/search', to: '/flatmates/join' });
  });

  it('ac9_error_boundary_fallback', () => {
    const reload = vi.fn();
    const original = window.location;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    function Broken(): never {
      throw new Error('render failed');
    }

    try {
      render(
        <AppErrorBoundary>
          <Broken />
        </AppErrorBoundary>,
      );
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(he.common.error);
      fireEvent.click(screen.getByRole('button', { name: he.common.retry }));
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });
});
