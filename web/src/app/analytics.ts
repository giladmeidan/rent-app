import posthog from 'posthog-js';
import type { CaptureResult, Properties } from 'posthog-js';

import { routePattern } from './routePattern';

// PostHog usage analytics from the browser (spec 0019b): off without VITE_POSTHOG_KEY; cookieless,
// nothing stored, no person, no autocapture, replay, surveys, flags or remote script; every URL is
// cut to its route pattern (ours) or its bare origin (anyone else's) before it is sent.

type UiEvents = {
  $pageview: Record<string, never>;
  search_run: { type: 'apartment' | 'room'; filters: number };
  listing_viewed: { listing_type: 'apartment' | 'room' };
  signup_started: { method: 'code' | 'google' };
};
export type UiEvent = keyof UiEvents;

const URL_KEYS = new Set([
  '$current_url',
  '$pathname',
  '$referrer',
  '$initial_current_url',
  '$initial_pathname',
  '$initial_referrer',
  '$session_entry_url',
  '$session_entry_pathname',
  '$session_entry_referrer',
]);
const HTTP_URL = /^https?:\/\//i;

let started = false;

function scrubValue(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (URL_KEYS.has(key) && value.startsWith('/')) return routePattern(value);
  if (!HTTP_URL.test(value)) return value;
  try {
    const url = new URL(value);
    return url.origin === window.location.origin
      ? url.origin + routePattern(url.pathname)
      : url.origin;
  } catch {
    return value.split(/[?#]/)[0];
  }
}

function scrubProperties(properties: Properties | undefined): void {
  if (properties === undefined) return;
  for (const key of Object.keys(properties)) {
    properties[key] = scrubValue(key, properties[key]);
  }
}

/** `before_send`: every URL or path in `properties`, `$set` and `$set_once` scrubbed in place. */
export function scrubEvent(event: CaptureResult | null): CaptureResult | null {
  if (event === null) return null;
  scrubProperties(event.properties);
  scrubProperties(event.$set);
  scrubProperties(event.$set_once);
  return event;
}

export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    // posthog-js defaults to the US host.
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com',
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
  started = true;
}

/** Send one UI event; a no-op before or without `initAnalytics`. */
export function capture<E extends UiEvent>(name: E, properties: UiEvents[E]): void {
  if (started) posthog.capture(name, properties);
}
