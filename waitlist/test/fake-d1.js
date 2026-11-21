// A fake D1 binding for the unit tests (spec 0017): `prepare().bind().run()/.first()/.all()` over an
// in-memory node:sqlite database built from the real migrations, so their CHECKs and UNIQUEs run too.
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url);

/** Every migration file, in name order (spec 0017d: 0001, then 0002, …). */
export const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => new URL(name, MIGRATIONS_DIR));

/** A database with the migrations applied; `upTo` (a file name prefix such as '0001') stops after that one. */
export function migratedDatabase({ upTo } = {}) {
  const db = new DatabaseSync(':memory:');
  for (const file of MIGRATIONS) {
    db.exec(readFileSync(file, 'utf8'));
    if (upTo !== undefined && file.pathname.split('/').pop().startsWith(upTo)) break;
  }
  return db;
}

/** Applies the migrations after `after` (a file name prefix) to `db`. */
export function migrateFrom(db, after) {
  let applying = false;
  for (const file of MIGRATIONS) {
    if (applying) db.exec(readFileSync(file, 'utf8'));
    else if (file.pathname.split('/').pop().startsWith(after)) applying = true;
  }
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
