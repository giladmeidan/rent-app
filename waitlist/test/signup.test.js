// Spec 0017: POST /api/signup and GET /api/count, called through the Functions' `onRequest` with a fake
// D1 over the real migration (fake-d1.js). Run with `node --test 'waitlist/test/*.test.js'` (Node 22).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';

import { onRequest as countRequest } from '../functions/api/count.js';
import { onRequest as signupRequest } from '../functions/api/signup.js';
import * as lib from '../lib/signup.js';
import * as validate from '../public/validate.js';
import { fakeD1 } from './fake-d1.js';

const ORIGIN = 'https://join.example.com';

function env(DB = fakeD1()) {
  return { DB, ALLOWED_ORIGIN: ORIGIN };
}

function signupRequestFor(body, { url = `${ORIGIN}/api/signup`, origin, type, method } = {}) {
  const headers = { 'Content-Type': type ?? 'application/json' };
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

const SEEKER = {
  side: 'seeker',
  email: '  Noa.Levi@Example.COM ',
  kind: 'room',
  city: 'tel-aviv',
  consent: true,
  website: '',
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
};

afterEach(() => {
  delete globalThis.caches;
});

test('ac1_seeker_signup_stored', async () => {
  const environment = env();
  const { response, json } = await post(environment, SEEKER);

  assert.equal(response.status, 200);
  assert.deepEqual(json, { ok: true });
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

  const [withPhone, withoutPhone] = rows(environment);
  assert.equal(withPhone.phone, '0521234567');
  assert.equal(withPhone.units, '3+');
  assert.equal(withPhone.available, '1-3m');
  assert.equal(withPhone.neighbourhood, 'הבורסה');
  assert.equal(withoutPhone.phone, null);
  assert.equal(withoutPhone.units, '3+');

  // The other spellings the rule accepts.
  assert.equal(validate.normalisePhone('972521234567'), '0521234567');
  assert.equal(validate.normalisePhone('(052) 123 4567'), '0521234567');
  assert.equal(validate.normalisePhone('   '), null);
});

test('ac3_duplicate_is_silent_and_sides_independent', async () => {
  const environment = env();
  const once = await post(environment, SEEKER);
  const twice = await post(environment, { ...SEEKER, email: 'noa.levi@example.com', kind: 'apartment' });
  assert.equal(once.response.status, 200);
  assert.deepEqual(twice.json, { ok: true });
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
  assert.deepEqual(json, { ok: true });
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
  // A D1 error that echoes the values back, the worst case for a log line.
  const failing = {
    prepare: () => ({
      bind: (...values) => ({
        run: async () => {
          throw new Error(`D1_ERROR: constraint failed for ${values.join(', ')} (+972 52-123-4567)`);
        },
      }),
    }),
  };
  const logged = t.mock.method(console, 'error', () => undefined);
  const { response, json } = await post({ DB: failing, ALLOWED_ORIGIN: ORIGIN }, LISTER);

  assert.equal(response.status, 500);
  assert.deepEqual(json, { error: 'server' });
  assert.equal(logged.mock.callCount(), 1);
  const line = logged.mock.calls[0].arguments.map(String).join(' ');
  assert.match(line, /waitlist: signup insert failed/);
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
    "script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; " +
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
