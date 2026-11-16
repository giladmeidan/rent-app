// A fake D1 binding for the unit tests (spec 0017): `prepare().bind().run()/.first()/.all()` over an
// in-memory node:sqlite database built from the real migration, so its CHECKs and UNIQUE run too.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export const MIGRATION = new URL('../migrations/0001_signups.sql', import.meta.url);

export function migratedDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(MIGRATION, 'utf8'));
  return db;
}

export function fakeD1(db = migratedDatabase()) {
  const calls = [];
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    run: async () => {
      calls.push(sql);
      const result = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: Number(result.changes) } };
    },
    first: async (column) => {
      calls.push(sql);
      const row = db.prepare(sql).get(...args);
      if (row === undefined) return null;
      return column === undefined ? { ...row } : row[column];
    },
    all: async () => {
      calls.push(sql);
      return { results: db.prepare(sql).all(...args).map((row) => ({ ...row })) };
    },
  });
  return { db, calls, prepare: (sql) => statement(sql) };
}
