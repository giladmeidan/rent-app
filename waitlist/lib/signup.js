// The waitlist's server logic (spec 0017): request guards, validation, the Turnstile check (0017b), insert
// and count. Every function takes the request and `env` (the D1 binding `env.DB`, the vars and the
// `TURNSTILE_SECRET` secret) as arguments, so the tests call it with a fake D1; siteverify goes through the
// global `fetch`, which the tests stub. The Functions in functions/api/ only switch on the method.
import { validateSignup } from '../public/validate.js';

// The page and the server share one rule set (AC9): re-exported so the test can compare the objects.
export { validateSignup };

/** The counter shows only from this many signups in total (spec 0017, default D1). */
export const COUNTER_MIN = 50;
export const MAX_BODY_BYTES = 4096;
const COUNT_MAX_AGE = 60;

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

// Cloudflare Turnstile (spec 0017b).
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TURNSTILE_ACTION = 'signup';
const TURNSTILE_TIMEOUT_MS = 5000;
/** Cloudflare's documented maximum token length. */
export const MAX_TOKEN_LENGTH = 2048;
/** Cloudflare's test secrets (always pass, always fail, always "spent"): they accept a dummy token. */
const TEST_SECRET = /^[123]x0{31}AA$/;
/** siteverify error codes that are our misconfiguration or Cloudflare's fault, not the visitor's. */
const UNAVAILABLE_CODES = new Set(['missing-input-secret', 'invalid-input-secret', 'internal-error']);

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

/** The request's own URL is a localhost origin: only `wrangler pages dev`, never a Cloudflare deploy. */
function isLocal(request) {
  return LOCAL_ORIGIN.test(new URL(request.url).origin);
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

function turnstileUnavailable(reason) {
  // A fixed line and a reason word or Cloudflare's error codes: never the token, the IP or the body.
  console.error(`waitlist: turnstile unavailable (${reason})`);
  return 'unavailable';
}

/**
 * Asks Cloudflare's siteverify whether `token` is a fresh Turnstile token for this site (spec 0017b).
 * Returns `'ok'`, `'invalid'` (the visitor's token is bad, spent, or for another action or host) or
 * `'unavailable'` (Cloudflare unreachable, slow or failing, or our secret rejected; logged here). On a
 * localhost request (`wrangler pages dev` with a test secret, whose answer carries neither our action nor
 * our hostname) only `success` is checked.
 */
export async function verifyTurnstile(token, ip, request, env) {
  const form = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  if (typeof ip === 'string' && ip !== '') form.set('remoteip', ip);
  let response;
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TURNSTILE_TIMEOUT_MS),
    });
  } catch (error) {
    return turnstileUnavailable(error?.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return turnstileUnavailable(`status ${response.status}`);
  }
  let data;
  try {
    data = JSON.parse(await response.text());
  } catch (error) {
    return turnstileUnavailable(error?.name === 'TimeoutError' ? 'timeout' : 'body');
  }
  if (data === null || typeof data !== 'object' || typeof data.success !== 'boolean') {
    return turnstileUnavailable('body');
  }
  if (data.success !== true) {
    const codes = (Array.isArray(data['error-codes']) ? data['error-codes'] : []).filter(
      (code) => typeof code === 'string' && /^[a-z-]{1,40}$/.test(code),
    );
    if (codes.some((code) => UNAVAILABLE_CODES.has(code))) {
      return turnstileUnavailable(codes.join(','));
    }
    return 'invalid';
  }
  if (isLocal(request)) return 'ok';
  const hostname = new URL(env.ALLOWED_ORIGIN).hostname;
  return data.action === TURNSTILE_ACTION && data.hostname === hostname ? 'ok' : 'invalid';
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

  // Turnstile (spec 0017b), after validation so field errors cost no siteverify call. It is never skipped:
  // no secret, or a test secret (it accepts any dummy token) off localhost, refuses every signup.
  const secret = env.TURNSTILE_SECRET;
  if (typeof secret !== 'string' || secret === '') {
    console.error('waitlist: turnstile secret missing');
    return json(503, { error: 'server' });
  }
  if (TEST_SECRET.test(secret) && !isLocal(request)) {
    console.error('waitlist: turnstile test secret refused');
    return json(503, { error: 'server' });
  }
  const token = body.turnstile;
  if (typeof token !== 'string' || token.length < 1 || token.length > MAX_TOKEN_LENGTH) {
    return json(403, { error: 'challenge' });
  }
  const verdict = await verifyTurnstile(token, request.headers.get('CF-Connecting-IP'), request, env);
  if (verdict === 'invalid') return json(403, { error: 'challenge' });
  if (verdict !== 'ok') return json(503, { error: 'server' });

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
