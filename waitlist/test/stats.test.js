// Spec 0017 AC18: stats.sql, the one SELECT `make waitlist-stats` runs, against the real migration in
// node:sqlite. It counts by side, city and type and never shows an address or a phone number.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { migratedDatabase } from './fake-d1.js';

const STATS = readFileSync(new URL('../stats.sql', import.meta.url), 'utf8');

const SEEKERS = [
  ['s1@example.com', 'room', 'tel-aviv'],
  ['s2@example.com', 'room', 'tel-aviv'],
  ['s3@example.com', 'apartment', 'tel-aviv'],
  ['s4@example.com', 'apartment', 'holon'],
];
// email, kind, city, units, available, phone
const LISTERS = [
  ['l1@example.com', 'apartment', 'ramat-gan', '1', 'now', '0521111111'],
  ['l2@example.com', 'apartment', 'ramat-gan', '3+', 'later', null],
  ['l3@example.com', 'apartment', 'ramat-gan', '2', 'now', '0532222222'],
  ['l4@example.com', 'room', 'givatayim', '3+', '1-3m', null],
  ['s1@example.com', 'room', 'tel-aviv', '1', 'now', '0543333333'],
];

function seeded() {
  const db = migratedDatabase();
  const seeker = db.prepare(
    "INSERT INTO signups (side, email, kind, city, consent) VALUES ('seeker', ?, ?, ?, 1)",
  );
  for (const row of SEEKERS) seeker.run(...row);
  const lister = db.prepare(
    "INSERT INTO signups (side, email, kind, city, units, available, phone, neighbourhood, consent) VALUES ('lister', ?, ?, ?, ?, ?, ?, 'הבורסה', 1)",
  );
  for (const row of LISTERS) lister.run(...row);
  return db;
}

test('ac18_stats_query', () => {
  // One statement, safe inside the Makefile's `--command "$$(cat stats.sql)"`.
  assert.ok(!STATS.includes(';'), 'stats.sql is a single statement with no semicolon');
  for (const char of ['$', '`', '"']) assert.ok(!STATS.includes(char), `stats.sql holds ${char}`);

  const db = seeded();
  const statement = db.prepare(STATS);
  const columns = statement.columns().map((column) => column.name);
  assert.deepEqual(columns, ['summary', 'side', 'kind', 'city', 'available', 'signups', 'units']);
  assert.ok(!columns.includes('email') && !columns.includes('phone'));

  const rows = statement.all().map((row) => ({ ...row }));
  const of = (summary) =>
    rows
      .filter((row) => row.summary === summary)
      .map(({ summary: _summary, ...rest }) => rest);

  assert.deepEqual(new Set(rows.map((row) => row.summary)), new Set([
    'by_side',
    'seeker_kind_city',
    'lister_kind_city',
    'lister_available',
    'lister_phone',
  ]));

  const blank = { side: null, kind: null, city: null, available: null, units: null };
  assert.deepEqual(of('by_side'), [
    { ...blank, side: 'lister', signups: 5 },
    { ...blank, side: 'seeker', signups: 4 },
  ]);
  assert.deepEqual(of('seeker_kind_city'), [
    { ...blank, kind: 'apartment', city: 'holon', signups: 1 },
    { ...blank, kind: 'apartment', city: 'tel-aviv', signups: 1 },
    { ...blank, kind: 'room', city: 'tel-aviv', signups: 2 },
  ]);
  // units: '1' + '3+' + '2' = 1 + 3 + 2 = 6 for apartments in Ramat Gan; '3+' counts as 3.
  assert.deepEqual(of('lister_kind_city'), [
    { ...blank, kind: 'apartment', city: 'ramat-gan', signups: 3, units: 6 },
    { ...blank, kind: 'room', city: 'givatayim', signups: 1, units: 3 },
    { ...blank, kind: 'room', city: 'tel-aviv', signups: 1, units: 1 },
  ]);
  assert.deepEqual(of('lister_available'), [
    { ...blank, available: '1-3m', signups: 1 },
    { ...blank, available: 'later', signups: 1 },
    { ...blank, available: 'now', signups: 3 },
  ]);
  assert.deepEqual(of('lister_phone'), [{ ...blank, signups: 3 }]);

  // No fixture address, phone or neighbourhood appears anywhere in the output.
  const output = JSON.stringify(rows);
  for (const [email] of [...SEEKERS, ...LISTERS]) assert.ok(!output.includes(email), email);
  for (const row of LISTERS) if (row[5]) assert.ok(!output.includes(row[5]), row[5]);
  assert.ok(!output.includes('@'));
  assert.ok(!output.includes('הבורסה'));
});
