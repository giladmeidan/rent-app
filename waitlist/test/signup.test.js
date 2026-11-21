// Spec 0017: POST /api/signup and GET /api/count, called through the Functions' `onRequest` with a fake
// D1 over the real migration (fake-d1.js). Run with `node --test 'waitlist/test/*.test.js'` (Node 22).
// Spec 0017b: siteverify is the global `fetch`, stubbed in beforeEach (it never reaches the network).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';

import { onRequest as countRequest } from '../functions/api/count.js';
import { onRequest as signupRequest } from '../functions/api/signup.js';
import * as lib from '../lib/signup.js';
import * as validate from '../public/validate.js';
import { fakeD1 } from './fake-d1.js';

const ORIGIN = 'https://join.example.com';

const SECRET = 'test-secret-not-cloudflare';

function env(DB = fakeD1()) {
  return { DB, ALLOWED_ORIGIN: ORIGIN, TURNSTILE_SECRET: SECRET };
}

function signupRequestFor(body, { url = `${ORIGIN}/api/signup`, origin, type, method, ip } = {}) {
  const headers = { 'Content-Type': type ?? 'application/json' };
  if (ip !== undefined) headers['CF-Connecting-IP'] = ip;
  const sent = origin === undefined ? new URL(url).origin : origin;
  if (sent !== null) headers.Origin = sent;
  return new Request(url, {
    method: method ?? 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function post(environment, body, options) {
  const request = signupRequestFor(body, options);
  const response = await signupRequest({ request, env: environment });
  return { response, json: await response.json() };
}

function rows(environment) {
  return environment.DB.db.prepare('SELECT * FROM signups ORDER BY id').all();
}

/** A referral code (spec 0017d). */
const CODE_RE = /^[a-hjkmnp-z2-9]{8}$/;

/** A success body (spec 0017d: `{ok: true, ref}` with a well-formed code). */
function assertOk(json) {
  assert.deepEqual(Object.keys(json).sort(), ['ok', 'ref']);
  assert.equal(json.ok, true);
  assert.match(json.ref, CODE_RE);
}

const SEEKER = {
  side: 'seeker',
  email: '  Noa.Levi@Example.COM ',
  kind: 'room',
  city: 'tel-aviv',
  consent: true,
  website: '',
  turnstile: 'tok',
};

const LISTER = {
  side: 'lister',
  email: 'owner@example.com',
  kind: 'apartment',
  city: 'ramat-gan',
  neighbourhood: '  הבורסה ',
  units: '3+',
  available: '1-3m',
  phone: '+972 52-123-4567',
  consent: true,
  website: '',
  turnstile: 'tok',
};

// The siteverify stub: every call is recorded; `answer` makes the response (or throws), per test.
const PASS = { success: true, action: 'signup', hostname: 'join.example.com' };
const realFetch = globalThis.fetch;
let siteverify;

function answerJson(body, status = 200) {
  return () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  siteverify = { calls: [], answer: answerJson(PASS) };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), lib.SITEVERIFY_URL, 'the only fetch is siteverify');
    siteverify.calls.push({ url: String(url), init });
    return siteverify.answer();
  };
});

afterEach(() => {
  delete globalThis.caches;
  globalThis.fetch = realFetch;
});

test('ac1_seeker_signup_stored', async () => {
  const environment = env();
  const { response, json } = await post(environment, SEEKER);

  assert.equal(response.status, 200);
  assertOk(json);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  const stored = rows(environment);
  assert.equal(stored.length, 1);
  const [row] = stored;
  assert.equal(row.side, 'seeker');
  assert.equal(row.email, 'noa.levi@example.com');
  assert.equal(row.kind, 'room');
  assert.equal(row.city, 'tel-aviv');
  assert.equal(row.consent, 1);
  assert.equal(row.neighbourhood, null);
  assert.equal(row.units, null);
  assert.equal(row.available, null);
  assert.equal(row.phone, null);
  assert.match(row.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
});

test('ac2_lister_signup_normalises_phone', async () => {
  const environment = env();
  const first = await post(environment, LISTER);
  assert.equal(first.response.status, 200);
  const second = await post(environment, { ...LISTER, email: 'second@example.com', phone: '' });
  assert.equal(second.response.status, 200);
  const trunk = await post(environment, {
    ...LISTER,
    email: 'third@example.com',
    phone: '+972 (0)52-123-4567',
  });
  assert.equal(trunk.response.status, 200);

  const [withPhone, withoutPhone, withTrunkZero] = rows(environment);
  assert.equal(withTrunkZero.phone, '0521234567');
  assert.equal(withPhone.phone, '0521234567');
  assert.equal(withPhone.units, '3+');
  assert.equal(withPhone.available, '1-3m');
  assert.equal(withPhone.neighbourhood, 'הבורסה');
  assert.equal(withoutPhone.phone, null);
  assert.equal(withoutPhone.units, '3+');

  // The other spellings the rule accepts.
  assert.equal(validate.normalisePhone('972521234567'), '0521234567');
  assert.equal(validate.normalisePhone('(052) 123 4567'), '0521234567');
  assert.equal(validate.normalisePhone('+9720521234567'), '0521234567');
  assert.equal(validate.normalisePhone('   '), null);
});

test('ac3_duplicate_is_silent_and_sides_independent', async () => {
  const environment = env();
  const once = await post(environment, SEEKER);
  const twice = await post(environment, { ...SEEKER, email: 'noa.levi@example.com', kind: 'apartment' });
  assert.equal(once.response.status, 200);
  assertOk(twice.json);
  assert.equal(twice.response.status, 200);
  assert.equal(rows(environment).length, 1);
  assert.equal(rows(environment)[0].kind, 'room'); // the first entry is kept, never edited

  const otherSide = await post(environment, { ...LISTER, email: 'NOA.levi@example.com' });
  assert.equal(otherSide.response.status, 200);
  const stored = rows(environment);
  assert.equal(stored.length, 2);
  assert.deepEqual(
    stored.map((row) => [row.side, row.email]),
    [
      ['seeker', 'noa.levi@example.com'],
      ['lister', 'noa.levi@example.com'],
    ],
  );
});

test('ac4_invalid_fields_rejected', async (t) => {
  const { units: _units, available: _available, ...listerWithoutUnitsOrAvailable } = LISTER;
  const { kind: _kind, ...seekerWithoutKind } = SEEKER;
  const cases = [
    ['a bad email', { ...SEEKER, email: 'not-an-email' }, ['email']],
    ['an email over 254 characters', { ...SEEKER, email: `${'a'.repeat(250)}@x.io` }, ['email']],
    ['an email with a NUL', { ...SEEKER, email: 'no\u0000a@example.com' }, ['email']],
    ['an email with a bidi override', { ...SEEKER, email: '\u202Emoc.elpmaxe@aon' }, ['email']],
    ['an email with a zero-width space', { ...SEEKER, email: 'noa\u200B@example.com' }, ['email']],
    ['an unknown city', { ...SEEKER, city: 'jerusalem' }, ['city']],
    ['a missing kind', seekerWithoutKind, ['kind']],
    ['consent false', { ...SEEKER, consent: false }, ['consent']],
    ['consent as a string', { ...SEEKER, consent: 'true' }, ['consent']],
    ['a lister without units or available', listerWithoutUnitsOrAvailable, ['units', 'available']],
    ['a lister with units "4"', { ...LISTER, units: '4' }, ['units']],
    ['a phone "123"', { ...LISTER, phone: '123' }, ['phone']],
    ['a seeker carrying phone', { ...SEEKER, phone: '0521234567' }, ['phone']],
    ['a seeker carrying units', { ...SEEKER, units: '1' }, ['units']],
    ['a neighbourhood over 60', { ...LISTER, neighbourhood: 'א'.repeat(61) }, ['neighbourhood']],
    ['a neighbourhood with a control', { ...LISTER, neighbourhood: 'a\u0007b' }, ['neighbourhood']],
    ['a neighbourhood with a bidi override', { ...LISTER, neighbourhood: 'א\u202Eב' }, ['neighbourhood']],
    ['a neighbourhood with a zero-width joiner', { ...LISTER, neighbourhood: 'א\u200Dב' }, ['neighbourhood']],
    ['an unknown side', { ...SEEKER, side: 'broker' }, ['side']],
    ['a JSON array', [], []],
  ];
  for (const [name, body, fields] of cases) {
    await t.test(name, async () => {
      const environment = env();
      const { response, json } = await post(environment, body);
      assert.equal(response.status, 400);
      assert.deepEqual(json, { error: 'invalid', fields });
      assert.equal(rows(environment).length, 0);
    });
  }
  await t.test('invalid JSON', async () => {
    const environment = env();
    const { response, json } = await post(environment, '{"side": "seeker",');
    assert.equal(response.status, 400);
    assert.deepEqual(json, { error: 'invalid', fields: [] });
    assert.equal(rows(environment).length, 0);
  });
});

test('ac5_honeypot_drops_silently', async () => {
  const environment = env();
  const { response, json } = await post(environment, { ...SEEKER, website: 'https://spam.example' });
  assert.equal(response.status, 200);
  assertOk(json);
  assert.equal(rows(environment).length, 0);

  // A filled honeypot wins even over an otherwise invalid body: bots always see success.
  const invalid = await post(environment, { website: 'x' });
  assert.equal(invalid.response.status, 200);
  assert.equal(rows(environment).length, 0);
});

test('ac6_origin_host_size_type_and_method_guards', async (t) => {
  await t.test('an Origin other than the request origin → 403', async () => {
    const environment = env();
    const { response, json } = await post(environment, SEEKER, { origin: 'https://evil.example' });
    assert.equal(response.status, 403);
    assert.deepEqual(json, { error: 'origin' });
    assert.equal(rows(environment).length, 0);
  });
  await t.test('no Origin → 403', async () => {
    const { response } = await post(env(), SEEKER, { origin: null });
    assert.equal(response.status, 403);
  });
  await t.test('a pages.dev host with a matching Origin → 403', async () => {
    const environment = env();
    const url = 'https://homie-waitlist.pages.dev/api/signup';
    const { response } = await post(environment, SEEKER, { url });
    assert.equal(response.status, 403);
    assert.equal(rows(environment).length, 0);
  });
  await t.test('a localhost host with a matching Origin → 200', async () => {
    for (const url of ['http://localhost:8788/api/signup', 'http://127.0.0.1:4179/api/signup']) {
      const environment = env();
      const { response } = await post(environment, SEEKER, { url });
      assert.equal(response.status, 200, url);
      assert.equal(rows(environment).length, 1);
    }
  });
  await t.test('a localhost Origin on the real host → 403', async () => {
    const { response } = await post(env(), SEEKER, { origin: 'http://localhost:8788' });
    assert.equal(response.status, 403);
  });
  await t.test('a body over 4 KB → 413', async () => {
    const environment = env();
    const big = JSON.stringify({ ...SEEKER, pad: 'x'.repeat(5000) });
    const { response } = await post(environment, big);
    assert.equal(response.status, 413);
    assert.equal(rows(environment).length, 0);
  });
  await t.test('a body over 4 KB without Content-Length → 413', async () => {
    const big = new TextEncoder().encode(JSON.stringify({ ...SEEKER, pad: 'x'.repeat(5000) }));
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(big.slice(0, 3000));
        controller.enqueue(big.slice(3000));
        controller.close();
      },
    });
    const request = new Request(`${ORIGIN}/api/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: stream,
      duplex: 'half',
    });
    assert.equal(request.headers.get('Content-Length'), null);
    const response = await signupRequest({ request, env: env() });
    assert.equal(response.status, 413);
  });
  await t.test('a Content-Type that is not JSON → 415; a charset parameter is fine', async () => {
    const { response } = await post(env(), SEEKER, { type: 'text/plain' });
    assert.equal(response.status, 415);
    const form = await post(env(), 'side=seeker', { type: 'application/x-www-form-urlencoded' });
    assert.equal(form.response.status, 415);
    const charset = await post(env(), SEEKER, { type: 'application/json; charset=utf-8' });
    assert.equal(charset.response.status, 200);
  });
  await t.test('a GET to /api/signup → 405 with Allow: POST', async () => {
    const request = new Request(`${ORIGIN}/api/signup`, { headers: { Origin: ORIGIN } });
    const response = await signupRequest({ request, env: env() });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'POST');
  });
});

async function seed(environment, n) {
  const insert = environment.DB.db.prepare(
    "INSERT INTO signups (side, email, kind, city, consent) VALUES ('seeker', ?, 'room', 'holon', 1)",
  );
  for (let i = 0; i < n; i += 1) insert.run(`person${i}@example.com`);
}

function getCount(environment) {
  const request = new Request(`${ORIGIN}/api/count`);
  return countRequest({ request, env: environment });
}

test('ac7_count_threshold_and_cache', async (t) => {
  await t.test('49 rows → null, 50 → 50, with Cache-Control', async () => {
    const environment = env();
    await seed(environment, 49);
    const below = await getCount(environment);
    assert.equal(below.status, 200);
    assert.deepEqual(await below.json(), { total: null });
    assert.equal(below.headers.get('Cache-Control'), 'public, max-age=60');
    assert.equal(below.headers.get('X-Content-Type-Options'), 'nosniff');

    environment.DB.db
      .prepare(
        "INSERT INTO signups (side, email, kind, city, consent) VALUES ('seeker', 'fifty@example.com', 'room', 'holon', 1)",
      )
      .run();
    const at = await getCount(environment);
    assert.deepEqual(await at.json(), { total: 50 });
    assert.equal(at.headers.get('Cache-Control'), 'public, max-age=60');
  });

  await t.test('a cached response is served without touching D1', async () => {
    const cached = new Response('{"total":777}', { headers: { 'Cache-Control': 'public, max-age=60' } });
    const seen = [];
    globalThis.caches = {
      default: {
        match: async (key) => {
          seen.push(key.url);
          return cached;
        },
        put: async () => assert.fail('a hit is not stored again'),
      },
    };
    const environment = env();
    const response = await getCount(environment);
    assert.equal(response, cached);
    assert.deepEqual(seen, [`${ORIGIN}/api/count`]);
    assert.deepEqual(environment.DB.calls, []);
  });

  await t.test('a miss reads D1 once and stores the response under the query-free URL', async () => {
    const store = new Map();
    globalThis.caches = {
      default: {
        match: async (key) => store.get(key.url),
        put: async (key, response) => store.set(key.url, response),
      },
    };
    const environment = env();
    await seed(environment, 60);
    const waited = [];
    const request = new Request(`${ORIGIN}/api/count?bust=1`);
    const first = await countRequest({
      request,
      env: environment,
      waitUntil: (promise) => waited.push(promise),
    });
    await Promise.all(waited);
    assert.deepEqual(await first.json(), { total: 60 });
    assert.deepEqual([...store.keys()], [`${ORIGIN}/api/count`]);
    const second = await getCount(environment);
    assert.deepEqual(await second.json(), { total: 60 });
    assert.equal(environment.DB.calls.length, 1);
  });

  await t.test('a pages.dev host answers null without D1 or the cache', async () => {
    globalThis.caches = {
      default: {
        match: async () => assert.fail('the cache is not read on a host that is not allowed'),
        put: async () => assert.fail('the cache is not written on a host that is not allowed'),
      },
    };
    const environment = env();
    await seed(environment, 60);
    const request = new Request('https://homie-waitlist.pages.dev/api/count');
    const response = await countRequest({ request, env: environment });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { total: null });
    assert.deepEqual(environment.DB.calls, []);
  });

  await t.test('a POST to /api/count → 405 with Allow: GET', async () => {
    const request = new Request(`${ORIGIN}/api/count`, { method: 'POST', body: '{}' });
    const response = await countRequest({ request, env: env() });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET');
  });

  await t.test('a D1 failure → 500 {error: server}', async (tt) => {
    const failing = { prepare: () => ({ first: async () => Promise.reject(new Error('D1 down')) }) };
    tt.mock.method(console, 'error', () => undefined);
    const response = await getCount({ DB: failing, ALLOWED_ORIGIN: ORIGIN });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'server' });
  });
});

test('ac8_db_failure_logged_without_pii', async (t) => {
  const email = 'owner@example.com';
  const phone = '0521234567';
  // A D1 error that echoes the values back, the worst case for a log line. Spec 0017d: the insert runs
  // with `.first()` (RETURNING), so both read and write throw the same error.
  const fail = (values) => async () => {
    throw new Error(`D1_ERROR: constraint failed for ${values.join(', ')} (+972 52-123-4567)`);
  };
  const failing = {
    prepare: () => ({
      bind: (...values) => ({ run: fail(values), first: fail(values) }),
    }),
  };
  const logged = t.mock.method(console, 'error', () => undefined);
  const { response, json } = await post(env(failing), LISTER);

  assert.equal(response.status, 500);
  assert.deepEqual(json, { error: 'server' });
  assert.equal(logged.mock.callCount(), 1);
  const line = logged.mock.calls[0].arguments.map(String).join(' ');
  assert.match(line, /waitlist: signup insert failed \(Error: D1_ERROR: constraint failed/);
  for (const secret of [email, phone, '521234567', '52-123-4567', '1234567']) {
    assert.ok(!line.includes(secret), `the log line holds ${secret}: ${line}`);
  }
  assert.ok(!JSON.stringify(json).includes(email));
});

test('ac9_single_validation_source', () => {
  // lib/signup.js runs exactly the page's rule functions: the same objects, not copies.
  assert.equal(lib.validateSignup, validate.validateSignup);
  const libSource = readFileSync(new URL('../lib/signup.js', import.meta.url), 'utf8');
  assert.match(libSource, /from '\.\.\/public\/validate\.js'/);
  assert.doesNotMatch(libSource, /EMAIL_RE|PHONE_RE|CITY_KEYS/);
  // The page imports the same module.
  const appSource = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /from '\.\/validate\.js'/);
  assert.doesNotMatch(appSource, /EMAIL_RE|PHONE_RE/);
});

test('ac17_headers_file', () => {
  const text = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  assert.equal(lines[0], '/*');
  const headers = new Map(
    lines.slice(1).map((line) => {
      assert.match(line, /^\s+\S/, 'every header line is indented under /*');
      const at = line.indexOf(':');
      return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/\s+/g, ' ')];
    }),
  );
  const csp =
    "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; " +
    "script-src 'self' https://challenges.cloudflare.com; connect-src 'self'; font-src 'self'; " +
    "frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; " +
    "base-uri 'none'; form-action 'self'";
  assert.deepEqual(
    Object.fromEntries(headers),
    {
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Strict-Transport-Security': 'max-age=31536000',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Spec 0017b: Turnstile.

const IP = '203.0.113.7';
const TOKEN = 'tok-0017b-a-real-looking-token';

test('ac1b_turnstile_ok_stores', async (t) => {
  await t.test('a token siteverify accepts → 200, one row, one POST with secret, response, remoteip', async () => {
    const environment = env();
    const { response, json } = await post(environment, { ...SEEKER, turnstile: TOKEN }, { ip: IP });
    assert.equal(response.status, 200);
    assertOk(json);
    const stored = rows(environment);
    assert.equal(stored.length, 1);
    assert.ok(!Object.hasOwn(stored[0], 'turnstile'), 'the token is not a column');
    assert.ok(!Object.values(stored[0]).includes(TOKEN), 'the token is not stored');

    assert.equal(siteverify.calls.length, 1);
    const [{ url, init }] = siteverify.calls;
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(init.method, 'POST');
    assert.ok(init.body instanceof URLSearchParams, 'a form-urlencoded body');
    assert.deepEqual(Object.fromEntries(init.body), { secret: SECRET, response: TOKEN, remoteip: IP });
    assert.ok(init.signal instanceof AbortSignal, 'the call has a timeout');
  });

  await t.test('no CF-Connecting-IP → remoteip is left out', async () => {
    const { response } = await post(env(), LISTER);
    assert.equal(response.status, 200);
    assert.deepEqual(Object.fromEntries(siteverify.calls[0].init.body), {
      secret: SECRET,
      response: 'tok',
    });
  });

  await t.test("localhost with the test secret's answer (no action, example.com) → 200", async () => {
    siteverify.answer = answerJson({ success: true, hostname: 'example.com' });
    const environment = { ...env(), TURNSTILE_SECRET: '1x0000000000000000000000000000000AA' };
    const { response } = await post(environment, SEEKER, { url: 'http://localhost:8788/api/signup' });
    assert.equal(response.status, 200);
    assert.equal(rows(environment).length, 1);
    assert.equal(siteverify.calls.length, 1);
  });
});

test('ac2b_turnstile_rejections', async (t) => {
  const { turnstile: _turnstile, ...withoutToken } = SEEKER;
  // [name, body, siteverify answer or null when siteverify must not be called]
  const cases = [
    ['a missing token', withoutToken, null],
    ['a number', { ...SEEKER, turnstile: 12345 }, null],
    ['an empty string', { ...SEEKER, turnstile: '' }, null],
    ['a token of 2049 characters', { ...SEEKER, turnstile: 'x'.repeat(2049) }, null],
    ['invalid-input-response', SEEKER, { success: false, 'error-codes': ['invalid-input-response'] }],
    ['timeout-or-duplicate', SEEKER, { success: false, 'error-codes': ['timeout-or-duplicate'] }],
    ['success: false with no codes', SEEKER, { success: false }],
    ["action 'other'", SEEKER, { ...PASS, action: 'other' }],
    ['no action', SEEKER, { success: true, hostname: 'join.example.com' }],
    ["hostname 'evil.example'", SEEKER, { ...PASS, hostname: 'evil.example' }],
  ];
  for (const [name, body, answer] of cases) {
    await t.test(name, async (tt) => {
      const logged = tt.mock.method(console, 'error', () => undefined);
      if (answer !== null) siteverify.answer = answerJson(answer);
      const environment = env();
      const { response, json } = await post(environment, body);
      assert.equal(response.status, 403);
      assert.deepEqual(json, { error: 'challenge' });
      assert.equal(rows(environment).length, 0);
      assert.equal(siteverify.calls.length, answer === null ? 0 : 1);
      assert.equal(logged.mock.callCount(), 0, 'a rejected token is not logged');
    });
  }
  await t.test('a token of exactly 2048 characters passes', async () => {
    const environment = env();
    const token = 'x'.repeat(2048);
    const { response } = await post(environment, { ...LISTER, turnstile: token });
    assert.equal(response.status, 200);
    assert.equal(rows(environment).length, 1);
    assert.equal(siteverify.calls[0].init.body.get('response'), token);
  });
});

test('ac3b_turnstile_unavailable_fails_closed', async (t) => {
  const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  const cases = [
    ['siteverify throws', () => Promise.reject(new TypeError('fetch failed')), 'network'],
    ['siteverify times out', () => Promise.reject(timeout), 'timeout'],
    ['a 500', answerJson({ success: false }, 500), 'status 500'],
    ['a body that is not JSON', () => new Response('<html>oops</html>', { status: 200 }), 'body'],
    ['JSON that is not an answer', answerJson(['success']), 'body'],
    ['invalid-input-secret', answerJson({ success: false, 'error-codes': ['invalid-input-secret'] }), 'invalid-input-secret'],
    ['missing-input-secret', answerJson({ success: false, 'error-codes': ['missing-input-secret'] }), 'missing-input-secret'],
    ['internal-error', answerJson({ success: false, 'error-codes': ['internal-error'] }), 'internal-error'],
  ];
  for (const [name, answer, reason] of cases) {
    await t.test(name, async (tt) => {
      const logged = tt.mock.method(console, 'error', () => undefined);
      siteverify.answer = answer;
      const environment = env();
      const { response, json } = await post(environment, { ...LISTER, turnstile: TOKEN }, { ip: IP });
      assert.equal(response.status, 503);
      assert.deepEqual(json, { error: 'server' });
      assert.equal(rows(environment).length, 0);
      assert.equal(siteverify.calls.length, 1);
      assert.equal(logged.mock.callCount(), 1);
      const line = logged.mock.calls[0].arguments.map(String).join(' ');
      assert.equal(line, `waitlist: turnstile unavailable (${reason})`);
      for (const secret of [TOKEN, IP, SECRET, 'owner@example.com', '521234567', '52-123-4567']) {
        assert.ok(!line.includes(secret), `the log line holds ${secret}: ${line}`);
      }
    });
  }
});

test('ac4b_missing_secret_refuses', async (t) => {
  const cases = [
    ['no TURNSTILE_SECRET', undefined, 'waitlist: turnstile secret missing'],
    ['an empty one', '', 'waitlist: turnstile secret missing'],
    ['the always-pass test secret', '1x0000000000000000000000000000000AA', 'waitlist: turnstile test secret refused'],
    ['the always-fail test secret', '2x0000000000000000000000000000000AA', 'waitlist: turnstile test secret refused'],
    ['the spent-token test secret', '3x0000000000000000000000000000000AA', 'waitlist: turnstile test secret refused'],
  ];
  for (const [name, secret, message] of cases) {
    await t.test(`${name} on the real host → 503, no siteverify call`, async (tt) => {
      const logged = tt.mock.method(console, 'error', () => undefined);
      const environment = env();
      if (secret === undefined) delete environment.TURNSTILE_SECRET;
      else environment.TURNSTILE_SECRET = secret;
      const { response, json } = await post(environment, SEEKER);
      assert.equal(response.status, 503);
      assert.deepEqual(json, { error: 'server' });
      assert.equal(rows(environment).length, 0);
      assert.equal(siteverify.calls.length, 0);
      assert.deepEqual(
        logged.mock.calls.map((call) => call.arguments.join(' ')),
        [message],
      );
    });
  }
});

test('ac5b_order_validation_before_turnstile', async (t) => {
  await t.test('invalid fields and no token → 400 with the fields, no siteverify call', async () => {
    const { turnstile: _turnstile, ...withoutToken } = SEEKER;
    const environment = env();
    const { response, json } = await post(environment, { ...withoutToken, city: 'jerusalem', consent: false });
    assert.equal(response.status, 400);
    assert.deepEqual(json, { error: 'invalid', fields: ['city', 'consent'] });
    assert.equal(siteverify.calls.length, 0);
  });
  await t.test('a filled honeypot → 200, no siteverify call, no row', async () => {
    const environment = env();
    const { response, json } = await post(environment, { ...SEEKER, website: 'https://spam.example' });
    assert.equal(response.status, 200);
    assertOk(json);
    assert.equal(rows(environment).length, 0);
    assert.equal(siteverify.calls.length, 0);
  });
  await t.test('a bad Origin → 403 origin, no siteverify call', async () => {
    const { response, json } = await post(env(), SEEKER, { origin: 'https://evil.example' });
    assert.equal(response.status, 403);
    assert.deepEqual(json, { error: 'origin' });
    assert.equal(siteverify.calls.length, 0);
  });
});

// ---------------------------------------------------------------------------------------------
// Spec 0017d: sources and referrals.

function rowOf(environment, side, email) {
  const row = environment.DB.db.prepare('SELECT * FROM signups WHERE side = ? AND email = ?').get(side, email);
  return row === undefined ? undefined : { ...row };
}

function count(environment) {
  return Number(environment.DB.db.prepare('SELECT COUNT(*) AS n FROM signups').get().n);
}

/** handleSignup with an injected code generator that hands out `codes` in order. */
async function postWithCodes(environment, body, codes) {
  const drawn = [];
  const queue = [...codes];
  const newRefCode = () => {
    const code = queue.length > 1 ? queue.shift() : queue[0];
    drawn.push(code);
    return code;
  };
  const response = await lib.handleSignup(signupRequestFor(body), environment, { newRefCode });
  return { response, json: await response.json(), drawn };
}

test('ac1d_stores_source_and_code', async () => {
  const environment = env();
  const { response, json } = await post(environment, { ...SEEKER, source: 'Instagram', campaign: 'bio' });
  assert.equal(response.status, 200);
  assertOk(json);
  const [row] = rows(environment);
  assert.equal(row.source, 'instagram');
  assert.equal(row.campaign, 'bio');
  assert.equal(row.ref_code, json.ref);
  assert.equal(row.referred_by, null);
  // Trimmed too, and the other columns as before.
  const lister = await post(environment, { ...LISTER, source: '  TikTok ', campaign: 'Reel_01-a' });
  assert.equal(lister.response.status, 200);
  const stored = rowOf(environment, 'lister', 'owner@example.com');
  assert.equal(stored.source, 'tiktok');
  assert.equal(stored.campaign, 'reel_01-a');
  assert.equal(stored.phone, '0521234567');
  assert.notEqual(stored.ref_code, row.ref_code);
});

test('ac2d_bad_attribution_is_dropped', async (t) => {
  const cases = [
    ['source "a b"', { source: 'a b' }],
    ['source "<x>"', { source: '<x>' }],
    ['source of 41 characters', { source: 'a'.repeat(41) }],
    ['source a number', { source: 42 }],
    ['source an object', { source: { a: 1 } }],
    ['source empty', { source: '' }],
    ['source starting with "-"', { source: '-x' }],
    ['campaign of 61 characters', { campaign: 'c'.repeat(61) }],
    ['campaign "a/b"', { campaign: 'a/b' }],
    ['ref "ABCDEFGH"', { ref: 'ABCDEFGH' }],
    ['ref "abcdefg" (7)', { ref: 'abcdefg' }],
    ['ref "abcdefgl" (l is not in the alphabet)', { ref: 'abcdefgl' }],
    ['ref a number', { ref: 12345678 }],
  ];
  for (const [name, extra] of cases) {
    await t.test(name, async () => {
      const environment = env();
      // A row whose code is the uppercase-free spelling of a bad ref, so a lax check would count it.
      environment.DB.db
        .prepare(
          "INSERT INTO signups (side, email, kind, city, consent, ref_code) VALUES ('seeker', 'other@example.com', 'room', 'holon', 1, 'abcdefgh')",
        )
        .run();
      const { response, json } = await post(environment, { ...SEEKER, ...extra });
      assert.equal(response.status, 200);
      assertOk(json);
      assert.ok(!Object.hasOwn(json, 'fields'));
      const row = rowOf(environment, 'seeker', 'noa.levi@example.com');
      assert.equal(row.source, null);
      assert.equal(row.campaign, null);
      assert.equal(row.referred_by, null);
    });
  }
  await t.test('validateSignup never reports attribution keys', () => {
    const result = validate.validateSignup({ ...SEEKER, source: '<x>', campaign: 7, ref: 'nope' });
    assert.equal(result.ok, true);
    const bad = validate.validateSignup({ ...SEEKER, email: 'x', source: '<x>', ref: 'nope' });
    assert.deepEqual(bad, { ok: false, fields: ['email'] });
  });
  await t.test('normaliseAttribution keeps limits exactly', () => {
    assert.deepEqual(
      validate.normaliseAttribution({ source: 'a'.repeat(40), campaign: 'b'.repeat(60), ref: 'k7m2pq9x' }),
      { source: 'a'.repeat(40), campaign: 'b'.repeat(60), ref: 'k7m2pq9x' },
    );
    assert.deepEqual(validate.normaliseAttribution(null), { source: null, campaign: null, ref: null });
    assert.deepEqual(validate.normaliseAttribution([]), { source: null, campaign: null, ref: null });
  });
});

test('ac3d_referral_only_for_existing_code', async () => {
  const environment = env();
  const a = await post(environment, { ...SEEKER, email: 'a@example.com' });
  const codeA = a.json.ref;

  const b = await post(environment, { ...SEEKER, email: 'b@example.com', ref: codeA });
  assert.equal(b.response.status, 200);
  assert.equal(rowOf(environment, 'seeker', 'b@example.com').referred_by, codeA);

  // A well-formed code no row has.
  let unknown = 'k7m2pq9x';
  while (unknown === codeA || unknown === b.json.ref) unknown = lib.newRefCode();
  const c = await post(environment, { ...SEEKER, email: 'c@example.com', ref: unknown });
  assert.equal(c.response.status, 200);
  assert.equal(rowOf(environment, 'seeker', 'c@example.com').referred_by, null);

  // A joins the other side through their own link: never their own referral.
  const self = await post(environment, { ...LISTER, email: 'A@Example.com', ref: codeA });
  assert.equal(self.response.status, 200);
  const otherSide = rowOf(environment, 'lister', 'a@example.com');
  assert.equal(otherSide.referred_by, null);
  assert.notEqual(otherSide.ref_code, codeA, 'one code per row');

  // A join through A's lister code counts too (either of a person's codes).
  const d = await post(environment, { ...SEEKER, email: 'd@example.com', ref: otherSide.ref_code });
  assert.equal(d.response.status, 200);
  assert.equal(rowOf(environment, 'seeker', 'd@example.com').referred_by, otherSide.ref_code);
});

test('ac4d_duplicate_returns_same_code_first_touch_wins', async () => {
  const environment = env();
  const a = await post(environment, { ...SEEKER, email: 'a@example.com', source: 'tiktok' });
  const b = await post(environment, { ...SEEKER, email: 'b@example.com' });
  const before = rowOf(environment, 'seeker', 'a@example.com');
  const total = count(environment);

  const again = await post(environment, {
    ...SEEKER,
    email: 'A@example.com',
    kind: 'apartment',
    source: 'instagram',
    campaign: 'bio',
    ref: b.json.ref,
  });
  assert.equal(again.response.status, 200);
  assertOk(again.json);
  assert.equal(again.json.ref, a.json.ref);
  assert.deepEqual(rowOf(environment, 'seeker', 'a@example.com'), before);
  assert.equal(before.source, 'tiktok');
  assert.equal(before.referred_by, null);
  assert.equal(count(environment), total);
});

test('ac5d_old_row_gets_a_code', async () => {
  const environment = env();
  environment.DB.db
    .prepare(
      "INSERT INTO signups (side, email, kind, city, consent, created_at) VALUES ('seeker', 'noa.levi@example.com', 'room', 'holon', 1, '2026-11-01T00:00:00Z')",
    )
    .run();
  const before = rowOf(environment, 'seeker', 'noa.levi@example.com');
  assert.equal(before.ref_code, null);

  const { response, json } = await post(environment, { ...SEEKER, source: 'instagram' });
  assert.equal(response.status, 200);
  assertOk(json);
  const after = rowOf(environment, 'seeker', 'noa.levi@example.com');
  assert.equal(after.ref_code, json.ref);
  assert.deepEqual({ ...after, ref_code: null }, before);
  assert.equal(count(environment), 1);

  // Asked again, the same code comes back.
  const again = await post(environment, SEEKER);
  assert.equal(again.json.ref, json.ref);
});

test('ac6d_no_enumeration_by_shape', async () => {
  const environment = env();
  const shape = (json) => Object.entries(json).map(([key, value]) => [key, typeof value]).sort();
  const fresh = await post(environment, SEEKER);
  const duplicate = await post(environment, SEEKER);
  const bot = await post(environment, { ...SEEKER, email: 'bot@example.com', website: 'x' });
  for (const answer of [fresh, duplicate, bot]) {
    assert.equal(answer.response.status, 200);
    assertOk(answer.json);
  }
  assert.deepEqual(shape(duplicate.json), shape(fresh.json));
  assert.deepEqual(shape(bot.json), shape(fresh.json));
  const stored = environment.DB.db.prepare('SELECT ref_code FROM signups').all().map((row) => row.ref_code);
  assert.deepEqual(stored, [fresh.json.ref]);
  assert.ok(!stored.includes(bot.json.ref), "the honeypot's code is not stored");
});

test('ac7d_code_collision_retries', async (t) => {
  await t.test('a code already stored → a fresh one is drawn and stored', async () => {
    const environment = env();
    await postWithCodes(environment, { ...SEEKER, email: 'first@example.com' }, ['aaaaaaaa']);
    const { response, json, drawn } = await postWithCodes(environment, SEEKER, ['aaaaaaaa', 'bbbbbbbb']);
    assert.equal(response.status, 200);
    assert.deepEqual(json, { ok: true, ref: 'bbbbbbbb' });
    assert.deepEqual(drawn, ['aaaaaaaa', 'bbbbbbbb']);
    assert.equal(rowOf(environment, 'seeker', 'noa.levi@example.com').ref_code, 'bbbbbbbb');
  });

  await t.test('an old row (no code) whose new code collides is retried like a new row', async () => {
    const environment = env();
    await postWithCodes(environment, { ...SEEKER, email: 'first@example.com' }, ['aaaaaaaa']);
    environment.DB.db
      .prepare(
        "INSERT INTO signups (side, email, kind, city, consent) VALUES ('seeker', 'old@example.com', 'room', 'holon', 1)",
      )
      .run();
    const { response, json } = await postWithCodes(
      environment,
      { ...SEEKER, email: 'old@example.com' },
      ['aaaaaaaa', 'cccccccc'],
    );
    assert.equal(response.status, 200);
    assert.deepEqual(json, { ok: true, ref: 'cccccccc' });
    assert.equal(rowOf(environment, 'seeker', 'old@example.com').ref_code, 'cccccccc');
  });

  await t.test('3 collisions → 500 server, no row, a log line without the email or phone', async (tt) => {
    const environment = env();
    await postWithCodes(environment, { ...SEEKER, email: 'first@example.com' }, ['aaaaaaaa']);
    const logged = tt.mock.method(console, 'error', () => undefined);
    const { response, json, drawn } = await postWithCodes(environment, LISTER, ['aaaaaaaa']);
    assert.equal(response.status, 500);
    assert.deepEqual(json, { error: 'server' });
    assert.equal(drawn.length, lib.REF_CODE_ATTEMPTS);
    assert.equal(lib.REF_CODE_ATTEMPTS, 3);
    assert.equal(rowOf(environment, 'lister', 'owner@example.com'), undefined);
    assert.equal(count(environment), 1);
    assert.equal(logged.mock.callCount(), 1);
    const line = logged.mock.calls[0].arguments.map(String).join(' ');
    assert.match(line, /^waitlist: signup insert failed \(.*UNIQUE constraint failed: signups\.ref_code/);
    for (const secret of ['owner@example.com', '0521234567', '521234567']) {
      assert.ok(!line.includes(secret), `the log line holds ${secret}: ${line}`);
    }
  });

  await t.test('any other error is not retried', async (tt) => {
    const environment = env();
    tt.mock.method(console, 'error', () => undefined);
    // A code that breaks the length CHECK: a constraint error, but not the code collision.
    const { response, drawn } = await postWithCodes(environment, SEEKER, ['short']);
    assert.equal(response.status, 500);
    assert.equal(drawn.length, 1);
    assert.equal(count(environment), 0);
  });
});

test('ac8d_code_alphabet', () => {
  assert.equal(lib.REF_ALPHABET, 'abcdefghjkmnpqrstuvwxyz23456789');
  assert.equal(lib.REF_ALPHABET.length, 31);
  const seen = Array.from({ length: 8 }, () => new Set());
  for (let i = 0; i < 10000; i += 1) {
    const code = lib.newRefCode();
    assert.match(code, CODE_RE);
    for (let position = 0; position < 8; position += 1) seen[position].add(code[position]);
  }
  for (const [position, letters] of seen.entries()) {
    assert.equal(letters.size, 31, `position ${position} misses a letter`);
  }
});
