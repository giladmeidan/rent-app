// Spec 0017 AC19: build.mjs writes the public contact address and the origin into .dist/index.html,
// run in a temp copy of waitlist/, and refuses placeholders and unsafe addresses. Spec 0017b AC11: the
// same for the Turnstile site key.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const WAITLIST = fileURLToPath(new URL('..', import.meta.url));

function copyWaitlist(origin) {
  const dir = mkdtempSync(join(tmpdir(), 'waitlist-build-'));
  for (const entry of ['build.mjs', 'public']) {
    cpSync(join(WAITLIST, entry), join(dir, entry), { recursive: true });
  }
  // Whatever origin the committed wrangler.toml holds (the placeholder, or the live one since PR #118).
  const toml = readFileSync(join(WAITLIST, 'wrangler.toml'), 'utf8');
  const line = /^ALLOWED_ORIGIN = "[^"]*"$/m;
  assert.equal(toml.match(new RegExp(line.source, 'gm'))?.length, 1, 'one ALLOWED_ORIGIN line');
  writeFileSync(join(dir, 'wrangler.toml'), toml.replace(line, `ALLOWED_ORIGIN = "${origin}"`));
  return dir;
}

const SITE_KEY = 'real-site-key-0123';

/** Runs build.mjs with exactly these values; `siteKey: null` leaves TURNSTILE_SITE_KEY unset. */
function build(dir, contact, siteKey = SITE_KEY) {
  const env = { ...process.env };
  delete env.CONTACT_EMAIL;
  delete env.TURNSTILE_SITE_KEY;
  if (contact !== undefined) env.CONTACT_EMAIL = contact;
  if (siteKey !== null) env.TURNSTILE_SITE_KEY = siteKey;
  return spawnSync(process.execPath, ['build.mjs'], { cwd: dir, env, encoding: 'utf8' });
}

test('ac19_build_writes_contact_and_origin', async (t) => {
  await t.test('writes the address and the origin into .dist only', () => {
    const dir = copyWaitlist('https://join.homie.test');
    try {
      const committed = readFileSync(join(dir, 'public', 'index.html'), 'utf8');
      assert.ok(committed.includes('mailto:contact@example.com'));
      assert.ok(committed.includes('https://join.example.com/img/og.png'));

      const result = build(dir, 'hello@homie.test');
      assert.equal(result.status, 0, result.stderr);

      const html = readFileSync(join(dir, '.dist', 'index.html'), 'utf8');
      assert.ok(!html.includes('contact@example.com'));
      assert.ok(!html.includes('https://join.example.com'));
      assert.ok(html.includes('mailto:hello@homie.test'));
      assert.ok(!html.includes('TURNSTILE_SITE_KEY_PLACEHOLDER'));
      assert.equal(html.split(`data-sitekey="${SITE_KEY}"`).length - 1, 2, 'both forms get the key');
      assert.match(html, /<meta property="og:image" content="https:\/\/join\.homie\.test\/img\/og\.png">/);
      assert.match(html, /<link rel="canonical" href="https:\/\/join\.homie\.test\/">/);
      // The rest of public/ is copied as is, and public/index.html is unchanged.
      assert.ok(existsSync(join(dir, '.dist', '_headers')));
      assert.ok(existsSync(join(dir, '.dist', 'app.js')));
      assert.equal(readFileSync(join(dir, 'public', 'index.html'), 'utf8'), committed);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('refuses an unusable address', () => {
    const dir = copyWaitlist('https://join.homie.test');
    try {
      for (const contact of [undefined, '', 'contact@example.com', 'a"b@homie.test', 'a<b@homie.test']) {
        const result = build(dir, contact);
        assert.notEqual(result.status, 0, `CONTACT_EMAIL=${contact}`);
        assert.match(result.stderr, /CONTACT_EMAIL/);
        assert.ok(!existsSync(join(dir, '.dist')), 'nothing is built');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('refuses the placeholder or a non-https origin', () => {
    for (const origin of ['https://join.example.com', 'http://join.homie.test', '']) {
      const dir = copyWaitlist(origin);
      try {
        const result = build(dir, 'hello@homie.test');
        assert.notEqual(result.status, 0, origin);
        assert.match(result.stderr, /ALLOWED_ORIGIN/);
        assert.ok(!existsSync(join(dir, '.dist')));
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

test('ac11b_site_key', async (t) => {
  await t.test('refuses a missing or malformed key and the placeholder', () => {
    const dir = copyWaitlist('https://join.homie.test');
    try {
      for (const key of [null, '', 'short', 'has a space 0123', 'a"b<c>d&0123456', 'x'.repeat(65), 'TURNSTILE_SITE_KEY_PLACEHOLDER']) {
        const result = build(dir, 'hello@homie.test', key);
        assert.notEqual(result.status, 0, `TURNSTILE_SITE_KEY=${key}`);
        assert.match(result.stderr, /TURNSTILE_SITE_KEY/);
        assert.ok(!existsSync(join(dir, '.dist')), 'nothing is built');
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test("refuses Cloudflare's test keys with a non-.test origin", () => {
    const dir = copyWaitlist('https://join.homie.co.il');
    try {
      for (const key of [
        '1x00000000000000000000AA',
        '2x00000000000000000000AB',
        '1x00000000000000000000BB',
        '2x00000000000000000000BB',
        '3x00000000000000000000FF',
      ]) {
        const result = build(dir, 'hello@homie.test', key);
        assert.notEqual(result.status, 0, key);
        assert.match(result.stderr, /TURNSTILE_SITE_KEY/);
        assert.ok(!existsSync(join(dir, '.dist')));
      }
      // The same origin builds with a real key.
      assert.equal(build(dir, 'hello@homie.test').status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('accepts the test key with https://join.homie.test, the committed page keeps the placeholder', () => {
    const dir = copyWaitlist('https://join.homie.test');
    try {
      const committed = readFileSync(join(dir, 'public', 'index.html'), 'utf8');
      assert.equal(committed.split('data-sitekey="TURNSTILE_SITE_KEY_PLACEHOLDER"').length - 1, 2);

      const result = build(dir, 'hello@homie.test', '1x00000000000000000000AA');
      assert.equal(result.status, 0, result.stderr);
      const html = readFileSync(join(dir, '.dist', 'index.html'), 'utf8');
      assert.ok(!html.includes('TURNSTILE_SITE_KEY_PLACEHOLDER'));
      assert.equal(html.split('data-sitekey="1x00000000000000000000AA"').length - 1, 2);
      assert.equal(readFileSync(join(dir, 'public', 'index.html'), 'utf8'), committed);
      // The repo's own page keeps it too.
      const repo = readFileSync(join(WAITLIST, 'public', 'index.html'), 'utf8');
      assert.ok(repo.includes('data-sitekey="TURNSTILE_SITE_KEY_PLACEHOLDER"'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Spec 0024a AC3: the page promises no rent estimate and names no nadlan.gov.il source.
test('ac3_no_rent_estimate_promise', () => {
  const html = readFileSync(join(WAITLIST, 'public', 'index.html'), 'utf8');
  assert.ok(!html.includes('nadlan'));
  assert.ok(!html.includes('הערכת שכר דירה'));
});
