// The waitlist's server logic (spec 0017): request guards, validation, insert and count. Pure: every
// function takes the request and `env` (with the D1 binding `env.DB`) as arguments, so the tests call it
// with a fake D1. The Functions in functions/api/ only switch on the method.
import { validateSignup } from '../public/validate.js';

// The page and the server share one rule set (AC9): re-exported so the test can compare the objects.
export { validateSignup };

/** The counter shows only from this many signups in total (spec 0017, default D1). */
export const COUNTER_MIN = 50;
export const MAX_BODY_BYTES = 4096;
const COUNT_MAX_AGE = 60;

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

const INSERT_SQL =
  'INSERT INTO signups (side, email, kind, city, neighbourhood, units, available, phone, consent) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT (side, email) DO NOTHING';
const COUNT_SQL = 'SELECT COUNT(*) AS n FROM signups';

/** A JSON response with the headers every Function sets itself (`_headers` covers static files only). */
export function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

export function methodNotAllowed(allow) {
  return json(405, { error: 'method' }, { Allow: allow });
}

/**
 * The request's own origin is ALLOWED_ORIGIN or a localhost origin. Anything else, `*.pages.dev`
 * included, is outside the zone's rate-limit rule (and, for the count, outside the edge cache).
 */
export function hostAllowed(request, env) {
  const own = new URL(request.url).origin;
  return (
    (typeof env.ALLOWED_ORIGIN === 'string' && own === env.ALLOWED_ORIGIN) || LOCAL_ORIGIN.test(own)
  );
}

/**
 * The request's host is allowed (above) and the `Origin` header equals its origin. This refuses
 * cross-site posts, a missing `Origin`, and posts to `*.pages.dev`.
 */
export function originAllowed(request, env) {
  return (
    hostAllowed(request, env) && request.headers.get('Origin') === new URL(request.url).origin
  );
}

function isJson(request) {
  const type = request.headers.get('Content-Type') ?? '';
  return type.split(';')[0].trim().toLowerCase() === 'application/json';
}

/** The body as bytes, or null once it passes `limit` (the stream is cancelled there). */
async function readLimited(request, limit) {
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function honeypotFilled(body) {
  if (body === null || typeof body !== 'object' || !Object.hasOwn(body, 'website')) return false;
  const value = body.website;
  return typeof value === 'string' ? value !== '' : value !== null && value !== undefined;
}

/** A D1 error's text with anything shaped like an address or a phone number taken out. */
function scrub(error) {
  const text = `${error?.name ?? 'Error'}: ${error?.message ?? ''}`;
  return text.replace(/[^\s@]+@[^\s@]+/g, '<email>').replace(/\+?\d[\d\s()-]{5,}\d/g, '<number>');
}

/** `POST /api/signup`. The guards run in the spec's order, each ending the request. */
export async function handleSignup(request, env) {
  if (!originAllowed(request, env)) return json(403, { error: 'origin' });
  if (!isJson(request)) return json(415, { error: 'content_type' });
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  if (declared > MAX_BODY_BYTES) return json(413, { error: 'too_large' });
  const bytes = await readLimited(request, MAX_BODY_BYTES);
  if (bytes === null) return json(413, { error: 'too_large' });

  let body;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return json(400, { error: 'invalid', fields: [] });
  }
  if (honeypotFilled(body)) return json(200, { ok: true });

  const result = validateSignup(body);
  if (!result.ok) return json(400, { error: 'invalid', fields: result.fields });

  const { side, email, kind, city, neighbourhood, units, available, phone } = result.value;
  try {
    await env.DB.prepare(INSERT_SQL)
      .bind(side, email, kind, city, neighbourhood, units, available, phone)
      .run();
  } catch (error) {
    // Never the email or the phone (NF2): a fixed line and the scrubbed error.
    console.error(`waitlist: signup insert failed (${scrub(error)})`);
    return json(500, { error: 'server' });
  }
  return json(200, { ok: true });
}

/**
 * `GET /api/count`: `{total: n}` from COUNTER_MIN signups, else `{total: null}`. The response is kept in
 * `cache` (the edge's `caches.default`) for 60 s, keyed by the URL without its query, so D1 counts at most
 * once a minute per location and a query string cannot bypass it. On a host that is not allowed
 * (`*.pages.dev`, where the Cache API does nothing and the rate-limit rule does not apply) it answers
 * `{total: null}` without touching D1 or the cache, so nobody can spend D1's daily reads there.
 */
export async function handleCount(request, env, cache, waitUntil) {
  if (!hostAllowed(request, env)) return json(200, { total: null });
  const url = new URL(request.url);
  url.search = '';
  const key = new Request(url.toString(), { method: 'GET' });
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  let n;
  try {
    const row = await env.DB.prepare(COUNT_SQL).first();
    n = Number(row?.n ?? 0);
  } catch (error) {
    console.error(`waitlist: count failed (${scrub(error)})`);
    return json(500, { error: 'server' });
  }
  const response = json(
    200,
    { total: n >= COUNTER_MIN ? n : null },
    { 'Cache-Control': `public, max-age=${COUNT_MAX_AGE}` },
  );
  if (cache) {
    // A failed cache write only costs the next request a D1 read.
    const stored = cache.put(key, response.clone()).catch(() => undefined);
    if (waitUntil) waitUntil(stored);
    else await stored;
  }
  return response;
}
