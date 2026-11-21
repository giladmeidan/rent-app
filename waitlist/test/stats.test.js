// Spec 0017 AC18: stats.sql, the one SELECT `make waitlist-stats` runs, against the real migration in
// node:sqlite. It counts by side, city and type and never shows an address or a phone number.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { migrateFrom, migratedDatabase } from './fake-d1.js';

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
  assert.deepEqual(columns, [
    'summary',
    'side',
    'kind',
    'city',
    'available',
    'signups',
    'units',
    'source',
    'campaign',
    'code',
  ]);
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
    // Spec 0017d. No referrer here has 3 joins, so top_referrers has no row (ac9d covers it).
    'by_source',
    'referrals',
  ]));

  const blank = {
    side: null,
    kind: null,
    city: null,
    available: null,
    units: null,
    source: null,
    campaign: null,
    code: null,
  };
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

// ---------------------------------------------------------------------------------------------
// Spec 0017d: sources and referrals.

const R1 = 'k7m2pq9x'; // 4 joins
const R2 = 'abcdefgh'; // 3 joins
const R3 = 'zzzz2222'; // 2 joins: below the list's bar

// side, email, source, campaign, ref_code, referred_by
const ATTRIBUTED = [
  ['seeker', 'ref1@example.com', 'instagram', 'bio', R1, null],
  ['lister', 'ref2@example.com', 'tiktok', null, R2, null],
  ['seeker', 'ref3@example.com', null, null, R3, null],
  ['seeker', 'j1@example.com', 'referral', null, 'jjjjjjj2', R1],
  ['seeker', 'j2@example.com', 'referral', null, null, R1],
  ['seeker', 'j3@example.com', 'referral', null, null, R1],
  ['lister', 'j4@example.com', 'referral', null, null, R1],
  ['seeker', 'j5@example.com', 'facebook', 'givatayim-rooms', null, R2],
  ['seeker', 'j6@example.com', 'facebook', 'givatayim-rooms', null, R2],
  ['seeker', 'j7@example.com', 'instagram', 'bio', null, R2],
  ['seeker', 'j8@example.com', null, null, null, R3],
  ['seeker', 'j9@example.com', null, null, null, R3],
];
const PHONE = '0549876543';

function seededWithAttribution() {
  const db = migratedDatabase();
  const insert = db.prepare(
    'INSERT INTO signups (side, email, kind, city, units, available, phone, consent, source, campaign, ref_code, referred_by) ' +
      "VALUES (?, ?, 'room', 'holon', ?, ?, ?, 1, ?, ?, ?, ?)",
  );
  for (const [side, email, source, campaign, code, referredBy] of ATTRIBUTED) {
    const lister = side === 'lister';
    insert.run(side, email, lister ? '1' : null, lister ? 'now' : null, lister ? PHONE : null, source, campaign, code, referredBy);
  }
  return db;
}

test('ac9d_sources_and_referrals', () => {
  const rows = seededWithAttribution()
    .prepare(STATS)
    .all()
    .map((row) => ({ ...row }));
  const of = (summary) =>
    rows
      .filter((row) => row.summary === summary)
      .map(({ summary: _summary, ...rest }) => rest);
  const blank = {
    side: null,
    kind: null,
    city: null,
    available: null,
    units: null,
    source: null,
    campaign: null,
    code: null,
  };

  assert.deepEqual(of('by_source'), [
    { ...blank, side: 'lister', source: 'referral', campaign: '-', signups: 1 },
    { ...blank, side: 'lister', source: 'tiktok', campaign: '-', signups: 1 },
    // Per side, the biggest channels first; ties in source and campaign order.
    { ...blank, side: 'seeker', source: 'direct', campaign: '-', signups: 3 },
    { ...blank, side: 'seeker', source: 'referral', campaign: '-', signups: 3 },
    { ...blank, side: 'seeker', source: 'facebook', campaign: 'givatayim-rooms', signups: 2 },
    { ...blank, side: 'seeker', source: 'instagram', campaign: 'bio', signups: 2 },
  ]);
  assert.deepEqual(of('referrals'), [{ ...blank, signups: 9 }]);
  // Only codes with 3+ joins, most first.
  assert.deepEqual(of('top_referrers'), [
    { ...blank, code: R1, signups: 4 },
    { ...blank, code: R2, signups: 3 },
  ]);

  const output = JSON.stringify(rows);
  assert.ok(!output.includes('@'));
  for (const [, email] of ATTRIBUTED) {
    assert.ok(!output.includes(email.split('@')[0] + '"'), `local part of ${email}`);
    assert.ok(!output.includes(email), email);
  }
  assert.ok(!output.includes(PHONE));
  assert.ok(!output.includes(R3), 'a code under 3 joins is not listed');
});

test('ac10d_migration_additive', async (t) => {
  await t.test('an empty database migrates in order and has the new columns and indexes', () => {
    const db = migratedDatabase();
    const columns = db.prepare('PRAGMA table_info(signups)').all().map((column) => column.name);
    for (const name of ['source', 'campaign', 'ref_code', 'referred_by']) assert.ok(columns.includes(name), name);
    const indexes = db.prepare('PRAGMA index_list(signups)').all().map((index) => index.name);
    assert.ok(indexes.includes('signups_ref_code'));
    assert.ok(indexes.includes('signups_referred_by'));
    // The code is unique; NULLs (old rows) are not.
    const insert = db.prepare(
      "INSERT INTO signups (side, email, kind, city, consent, ref_code) VALUES ('seeker', ?, 'room', 'holon', 1, ?)",
    );
    insert.run('a@example.com', null);
    insert.run('b@example.com', null);
    insert.run('c@example.com', 'abcdefgh');
    assert.throws(() => insert.run('d@example.com', 'abcdefgh'), /UNIQUE constraint failed: signups\.ref_code/);
    assert.throws(() => insert.run('e@example.com', 'short'), /CHECK constraint failed/);
  });

  await t.test('0001-era rows keep their data with the new columns NULL', () => {
    const db = migratedDatabase({ upTo: '0001' });
    const before = db.prepare('PRAGMA table_info(signups)').all().map((column) => column.name);
    assert.ok(!before.includes('source'), 'stopped after 0001');
    db.prepare(
      "INSERT INTO signups (side, email, kind, city, consent, created_at) VALUES ('seeker', 'old@example.com', 'room', 'holon', 1, '2026-11-16T09:00:00Z')",
    ).run();
    db.prepare(
      "INSERT INTO signups (side, email, kind, city, units, available, phone, consent) VALUES ('lister', 'old@example.com', 'apartment', 'holon', '2', 'now', '0521234567', 1)",
    ).run();
    const old = db.prepare('SELECT * FROM signups ORDER BY id').all().map((row) => ({ ...row }));

    migrateFrom(db, '0001');
    const migrated = db.prepare('SELECT * FROM signups ORDER BY id').all().map((row) => ({ ...row }));
    assert.deepEqual(
      migrated,
      old.map((row) => ({ ...row, source: null, campaign: null, ref_code: null, referred_by: null })),
    );
    // stats.sql runs on the migrated old data.
    const rows = db.prepare(STATS).all().map((row) => ({ ...row }));
    const bySource = rows.filter((row) => row.summary === 'by_source').map((row) => [row.side, row.source, row.campaign, row.signups]);
    assert.deepEqual(bySource, [
      ['lister', 'direct', '-', 1],
      ['seeker', 'direct', '-', 1],
    ]);
  });
});
