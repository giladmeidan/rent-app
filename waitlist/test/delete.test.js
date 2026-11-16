// Spec 0017 review B1: `make waitlist-delete` builds its SQL from the hex of the normalised address, so an
// address that is valid under the email rule but full of quotes deletes only its own rows.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { deleteStatements } from '../delete.mjs';
import { migratedDatabase } from './fake-d1.js';

const INJECTION = "x'or'a'='a'or'@b.co";

function seeded() {
  const db = migratedDatabase();
  const seeker = db.prepare(
    "INSERT INTO signups (side, email, kind, city, consent) VALUES ('seeker', ?, 'room', 'holon', 1)",
  );
  for (const email of [INJECTION, 'noa@example.com', 'דנה@example.co.il']) seeker.run(email);
  db.prepare(
    "INSERT INTO signups (side, email, kind, city, units, available, consent) VALUES ('lister', 'noa@example.com', 'room', 'holon', '1', 'now', 1)",
  ).run();
  return db;
}

const emails = (db) => db.prepare('SELECT side, email FROM signups ORDER BY id').all().map((row) => `${row.side}:${row.email}`);

test('b1_delete_by_hex_is_injection_safe', async (t) => {
  await t.test('the injection address deletes exactly its own row', () => {
    const db = seeded();
    const statements = deleteStatements(`  ${INJECTION.toUpperCase()} `);
    for (const sql of [statements.count, statements.remove]) {
      // The address never enters the SQL as text: only upper-case hex between the quotes.
      assert.match(sql, /WHERE hex\(email\) = '[0-9A-F]+'$/);
      assert.ok(!sql.toLowerCase().includes("x'or"), sql);
    }
    assert.equal(db.prepare(statements.count).get().matching, 1);
    const result = db.prepare(statements.remove).run();
    assert.equal(Number(result.changes), 1);
    assert.deepEqual(emails(db), ['seeker:noa@example.com', 'seeker:דנה@example.co.il', 'lister:noa@example.com']);
  });

  await t.test('an address on both sides deletes both rows; non-ASCII matches by its UTF-8 bytes', () => {
    const db = seeded();
    const both = deleteStatements('Noa@Example.com');
    assert.equal(db.prepare(both.count).get().matching, 2);
    assert.equal(Number(db.prepare(both.remove).run().changes), 2);
    const hebrew = deleteStatements('דנה@example.co.il');
    assert.equal(Number(db.prepare(hebrew.remove).run().changes), 1);
    assert.deepEqual(emails(db), [`seeker:${INJECTION}`]);
  });

  await t.test('shell syntax is just bytes, and invalid input builds nothing', () => {
    const shell = deleteStatements('$(id)`id`@evil.tld');
    assert.match(shell.remove, /^DELETE FROM signups WHERE hex\(email\) = '[0-9A-F]+'$/);
    for (const bad of ['', 'not-an-email', 'a b@c.de', 'a‮@b.co', undefined]) {
      assert.equal(deleteStatements(bad), null, String(bad));
    }
  });

  await t.test('no shell: wrangler runs through execFileSync, the address only from stdin', () => {
    const source = readFileSync(new URL('../delete.mjs', import.meta.url), 'utf8');
    assert.match(source, /execFileSync\(\s*'pnpm'/);
    assert.doesNotMatch(source, /\bexecSync\b|\bspawnSync\b|shell:\s*true|process\.argv\[2\]/);
    assert.match(source, /process\.stdin/);
  });
});
