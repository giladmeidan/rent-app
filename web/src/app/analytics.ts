// Before posthog-js: it reads the toolbar's `__posthog` hash parameter when its module is evaluated.
import './toolbarHash';
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

// Sent with no URL in them, but personal: `title` is `document.title` (a chat's other name, a listing's
// title), `ph_keyword` a search engine's query from the referrer.
const DROPPED = new Set(['title', 'ph_keyword']);
const HTTP_URL = /^https?:\/\//i;

let started = false;

function scrubValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  // Any path (`$pathname`, `$prev_pageview_pathname`, ...): its route pattern.
  if (value.startsWith('/')) return routePattern(value);
  if (!HTTP_URL.test(value)) return value;
  try {
    const url = new URL(value);
    return url.origin === window.location.origin
      ? url.origin + routePattern(url.pathname)
      : url.origin;
  } catch {
    return '';
  }
}

function scrubProperties(properties: Properties | undefined): Properties | undefined {
  if (properties === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([key]) => !DROPPED.has(key))
      .map(([key, value]) => [key, scrubValue(value)]),
  );
}

/** `before_send`: in `properties`, `$set` and `$set_once`, `DROPPED` removed and every URL or path
 * scrubbed. */
export function scrubEvent(event: CaptureResult | null): CaptureResult | null {
  if (event === null) return null;
  return {
    ...event,
    properties: scrubProperties(event.properties) ?? {},
    $set: scrubProperties(event.$set),
    $set_once: scrubProperties(event.$set_once),
  };
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
    // No utm_*, gclid, fbclid ... read from the query string.
    save_campaign_params: false,
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
