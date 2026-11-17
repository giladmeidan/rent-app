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
      save_campaign_params: false,
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
          broken_link: 'https://[bad/x?token=1',
          $prev_pageview_pathname: '/chat/3f2c9a1e-0000-4000-8000-000000000001',
          title: 'דנה לוי · homie',
          ph_keyword: 'דירה ברמת גן',
          $search_engine: 'google',
          type: 'apartment',
          filters: 3,
        },
        $set: { $current_url: `${origin}/search?price_max=8000`, title: 'דנה לוי' },
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
      broken_link: '',
      $prev_pageview_pathname: '/chat/:id',
      $search_engine: 'google',
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

  it('ac10_toolbar_hash_dropped_before_posthog_loads', async () => {
    const { dropToolbarHash } = await import('../toolbarHash');
    const go = (url: string) => window.history.replaceState(null, '', url);
    const here = () =>
      `${window.location.pathname}${window.location.search}${window.location.hash}`;

    go('/listings/abc?x=1#__posthog=eyJ0b2tlbiI6InBoYyJ9&keep=1');
    dropToolbarHash(); // off without a key
    expect(here()).toBe('/listings/abc?x=1#__posthog=eyJ0b2tlbiI6InBoYyJ9&keep=1');

    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    dropToolbarHash();
    expect(here()).toBe('/listings/abc?x=1#keep=1');
    go('/#state=abc');
    dropToolbarHash();
    expect(here()).toBe('/');
    go('/flatmates/join#invite-token');
    dropToolbarHash();
    expect(here()).toBe('/flatmates/join#invite-token');
  });
});
