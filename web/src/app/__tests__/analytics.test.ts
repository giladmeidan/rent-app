import type { CaptureResult } from 'posthog-js';
import posthog from 'posthog-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('posthog-js', () => ({ default: { init: vi.fn(), capture: vi.fn() } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(posthog.init).mockClear();
  vi.mocked(posthog.capture).mockClear();
});

/** A fresh module each time: `initAnalytics` sets module state. */
const load = async () => {
  vi.resetModules();
  return import('../analytics');
};

const result = (event: Partial<CaptureResult>): CaptureResult => ({
  uuid: 'u',
  event: '$pageview',
  properties: {},
  ...event,
});

describe('analytics', () => {
  it('ac8_off_without_key', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    const { capture, initAnalytics } = await load();
    capture('search_run', { type: 'room', filters: 1 }); // before init
    initAnalytics();
    capture('listing_viewed', { listing_type: 'room' });
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('ac9_privacy_config', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('VITE_POSTHOG_HOST', '');
    const { capture, initAnalytics, scrubEvent } = await load();
    initAnalytics();
    expect(posthog.init).toHaveBeenCalledOnce();
    expect(posthog.init).toHaveBeenCalledWith('phc_test', {
      api_host: 'https://eu.i.posthog.com',
      cookieless_mode: 'always',
      persistence: 'memory',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_flags: true,
      disable_external_dependency_loading: true,
      before_send: scrubEvent,
    });
    capture('signup_started', { method: 'code' });
    expect(posthog.capture).toHaveBeenCalledWith('signup_started', { method: 'code' });

    vi.stubEnv('VITE_POSTHOG_HOST', 'https://ph.example.com');
    (await load()).initAnalytics();
    expect(vi.mocked(posthog.init).mock.calls[1]?.[1]).toMatchObject({
      api_host: 'https://ph.example.com',
    });
  });

  it('ac10_urls_scrubbed', async () => {
    const { scrubEvent } = await load();
    const origin = window.location.origin;
    const event = scrubEvent(
      result({
        properties: {
          $current_url: `${origin}/listings/abc?budget=5000#x`,
          $pathname: '/listings/abc?budget=5000#x',
          $referrer: 'https://www.google.com/search?q=dira',
          $initial_referrer: '$direct',
          $session_entry_url: `${origin}/chat/c1#m`,
          $session_entry_pathname: '/me/listings/abc/edit',
          other_link: 'https://example.org/x/y?token=1',
          type: 'apartment',
          filters: 3,
        },
        $set: { $current_url: `${origin}/search?price_max=8000` },
        $set_once: {
          $initial_current_url: `${origin}/listings/abc?budget=5000#x`,
          $initial_pathname: '/flatmates/join#token',
        },
      }),
    );
    expect(event?.properties).toEqual({
      $current_url: `${origin}/listings/:id`,
      $pathname: '/listings/:id',
      $referrer: 'https://www.google.com',
      $initial_referrer: '$direct',
      $session_entry_url: `${origin}/chat/:id`,
      $session_entry_pathname: '/me/listings/:id/edit',
      other_link: 'https://example.org',
      type: 'apartment',
      filters: 3,
    });
    expect(event?.$set).toEqual({ $current_url: `${origin}/search` });
    expect(event?.$set_once?.$initial_current_url).toBe(`${origin}/listings/:id`);
    expect(event?.$set_once?.$initial_pathname).not.toMatch(/[?#]/);
    for (const bag of [event?.properties, event?.$set, event?.$set_once]) {
      for (const value of Object.values(bag ?? {})) {
        if (typeof value === 'string') expect(value).not.toMatch(/[?#]/);
      }
    }
    expect(scrubEvent(null)).toBeNull();
  });
});
