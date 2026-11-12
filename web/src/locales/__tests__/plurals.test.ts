import { describe, expect, it } from 'vitest';

import i18n from '../../app/i18n';
import he from '../he.json';

const SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Every string leaf of the catalogue: dotted path -> value. */
function leaves(node: object, prefix = ''): [string, string][] {
  return Object.entries(node).flatMap(([name, value]: [string, unknown]) => {
    const path = prefix === '' ? name : `${prefix}.${name}`;
    if (typeof value === 'string') return [[path, value] as [string, string]];
    return typeof value === 'object' && value !== null ? leaves(value, path) : [];
  });
}

const all = leaves(he);
const values = new Map(all);

/** base -> its forms (category -> text). */
const families = new Map<string, Map<string, string>>();
for (const [path, value] of all) {
  const match = SUFFIX.exec(path);
  if (match === null) continue;
  const base = path.slice(0, -match[0].length);
  const forms = families.get(base) ?? new Map<string, string>();
  forms.set(match[1] as string, value);
  families.set(base, forms);
}

describe('plurals', () => {
  it('ac2_every_family_renders', () => {
    expect(new Intl.PluralRules('he').resolvedOptions().pluralCategories).toEqual([
      'one',
      'two',
      'other',
    ]);
    expect(families.size).toBeGreaterThan(0);
    for (const [base, forms] of families) {
      // A dummy for every `{{var}}` in its forms other than count.
      const vars: Record<string, string> = {};
      for (const text of forms.values()) {
        for (const [, name] of text.matchAll(/\{\{(\w+)\}\}/g)) {
          if (name !== 'count') vars[name as string] = 'x';
        }
      }
      const render = (count: number) => i18n.t(base, { ...vars, count });
      for (const count of [0, 1, 2, 3, 11, 1.5]) {
        const text = render(count);
        expect(text, `${base} ${String(count)}`).not.toBe(base);
        expect(text, `${base} ${String(count)}`).not.toContain('{{');
      }
      const fill = (form: string, count: number) =>
        (forms.get(form) ?? '').replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
          name === 'count' ? String(count) : (vars[name] ?? ''),
        );
      expect(render(1), base).toBe(fill('one', 1));
      expect(render(2), base).toBe(fill('two', 2));
      if (forms.has('zero')) expect(render(0), base).toBe(fill('zero', 0));
    }
  });

  it('ac5_replaced_keys_removed', () => {
    const removed = [
      'listings.roomPreview.flatmatesOne',
      'listings.roomPreview.flatmatesOneAge',
      'listings.card.parkingOne',
      'listings.card.parkingMany',
      'listing.parkingOne',
      'listing.parkingMany',
      'listings.mine.peopleLikedOne',
      'search.countOne',
      'people.countOne',
      'likes.badgeLabelOne',
      'rooms.flatmates.one',
      'rooms.flatmates.many',
      'rooms.flatmates.withAges',
      'applications.count.zero',
      'applications.count.one',
      'applications.count.many',
      // Bases that became families: no plain string remains under the base path.
      'auth.resendIn',
      'listings.fields.charsLeft',
      'chat.composer.remaining',
      'listings.roomPreview.flatmates',
      'listings.roomPreview.flatmatesAges',
      'listings.card.title',
      'listings.card.roomTitle',
      'listings.mine.peopleLiked',
      'applicants.newBadge',
      'search.count',
      'applications.count',
      'people.count',
      'likes.badgeLabel',
      'rooms.flatmates',
    ];
    for (const key of removed) expect(values.has(key), key).toBe(false);
    // The objects that held forms are gone too.
    expect(he.applications).not.toHaveProperty('count');
    expect(he.rooms).not.toHaveProperty('flatmates');
  });

  it('ac5_fixed_patterns_do_not_return', () => {
    const patterns = [
      '\u05d1\u05e2\u05dc \u05d4\u05d3\u05d9\u05e8\u05d4 \u05de\u05d7\u05e4\u05e9',
      '\u05d1\u05e2\u05dc \u05d4\u05d3\u05d9\u05e8\u05d4 \u05de\u05d1\u05e7\u05e9',
      '\u05de\u05e2\u05d3\u05d9\u05e4/',
      '\u05e9\u05d5\u05dc\u05d7\u2026',
      '\u05dc-{{',
      '\u05d4\u05db\u05dc (',
      '\u00b7 \u05de\u05de\u05d5\u05d9\u05e0\u05d5\u05ea',
    ];
    for (const [path, value] of all) {
      for (const pattern of patterns) expect(value, path).not.toContain(pattern);
    }
  });
});
