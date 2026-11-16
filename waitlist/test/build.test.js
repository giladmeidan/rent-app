// Spec 0017 AC19: build.mjs writes the public contact address and the origin into .dist/index.html,
// run in a temp copy of waitlist/, and refuses placeholders and unsafe addresses.
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
  const toml = readFileSync(join(WAITLIST, 'wrangler.toml'), 'utf8');
  assert.match(toml, /^ALLOWED_ORIGIN = "[^"]+"$/m);
  writeFileSync(
    join(dir, 'wrangler.toml'),
    toml.replace(/^ALLOWED_ORIGIN = "[^"]+"$/m, `ALLOWED_ORIGIN = "${origin}"`),
  );
  return dir;
}

function build(dir, contact) {
  const env = { ...process.env };
  delete env.CONTACT_EMAIL;
  if (contact !== undefined) env.CONTACT_EMAIL = contact;
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
