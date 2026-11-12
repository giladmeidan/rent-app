import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import i18n from '../../../app/i18n';
import { cardTitle } from '../cardTitle';

const street = '\u05d4\u05e8\u05e6\u05dc';
const city = '\u05e8\u05de\u05ea \u05d2\u05df';
const title = (listing_type: 'apartment' | 'room', rooms: number) =>
  cardTitle(i18n.t, { listing_type, rooms, street, city });

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') yield* sources(path);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      yield path;
    }
  }
}

describe('cardTitle', () => {
  it('ac3_titles_by_rooms_and_type', () => {
    expect(title('apartment', 1)).toBe(
      '\u05d7\u05d3\u05e8 \u05d0\u05d7\u05d3, \u05e8\u05d7\u05d5\u05d1 \u05d4\u05e8\u05e6\u05dc, \u05e8\u05de\u05ea \u05d2\u05df',
    );
    expect(title('apartment', 2)).toBe(
      '2 \u05d7\u05d3\u05e8\u05d9\u05dd, \u05e8\u05d7\u05d5\u05d1 \u05d4\u05e8\u05e6\u05dc, \u05e8\u05de\u05ea \u05d2\u05df',
    );
    expect(title('apartment', 2.5)).toBe(
      '2.5 \u05d7\u05d3\u05e8\u05d9\u05dd, \u05e8\u05d7\u05d5\u05d1 \u05d4\u05e8\u05e6\u05dc, \u05e8\u05de\u05ea \u05d2\u05df',
    );
    expect(title('room', 1)).toBe(
      '\u05d7\u05d3\u05e8 \u05d1\u05d3\u05d9\u05e8\u05ea \u05d7\u05d3\u05e8 \u05d0\u05d7\u05d3, \u05e8\u05d7\u05d5\u05d1 \u05d4\u05e8\u05e6\u05dc, \u05e8\u05de\u05ea \u05d2\u05df',
    );
    expect(title('room', 4)).toBe(
      '\u05d7\u05d3\u05e8 \u05d1\u05be4 \u05d7\u05d3\u05e8\u05d9\u05dd, \u05e8\u05d7\u05d5\u05d1 \u05d4\u05e8\u05e6\u05dc, \u05e8\u05de\u05ea \u05d2\u05df',
    );
  });

  it('ac4_only_cardTitle_reads_title_keys', () => {
    const readers = [...sources(srcDir)]
      .filter((path) => {
        const text = readFileSync(path, 'utf8');
        return text.includes('listings.card.title') || text.includes('listings.card.roomTitle');
      })
      .map((path) => relative(srcDir, path));
    expect(readers).toEqual([join('features', 'listings', 'cardTitle.ts')]);
  });
});
