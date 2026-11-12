import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type Width = 'narrow' | 'default' | 'wide';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');

/** Every routed page (spec 0009h §2), by the component `app/routes.tsx` imports. */
const PAGES: Record<string, { file: string; width: Width }> = {
  // `/`: its pending state; the landing itself is in INNER.
  HomeRoute: { file: 'features/landing/HomeRoute.tsx', width: 'default' },
  LoginPage: { file: 'features/auth/LoginPage.tsx', width: 'narrow' },
  SignupPage: { file: 'features/auth/SignupPage.tsx', width: 'narrow' },
  SearchPage: { file: 'features/search/SearchPage.tsx', width: 'wide' },
  ListingPage: { file: 'features/listings/ListingPage.tsx', width: 'default' },
  JoinFlatPage: { file: 'features/flatmates/JoinFlatPage.tsx', width: 'narrow' },
  NewListingPage: { file: 'features/listings/NewListingPage.tsx', width: 'wide' },
  MyListingsPage: { file: 'features/listings/MyListingsPage.tsx', width: 'narrow' },
  EditListingPage: { file: 'features/listings/EditListingPage.tsx', width: 'wide' },
  ApplicantsPage: { file: 'features/applicants/ApplicantsPage.tsx', width: 'default' },
  PeoplePage: { file: 'features/people/PeoplePage.tsx', width: 'wide' },
  FlatmatesPage: { file: 'features/flatmates/FlatmatesPage.tsx', width: 'default' },
  MyApplicationsPage: { file: 'features/applications/MyApplicationsPage.tsx', width: 'default' },
  MyLikesPage: { file: 'features/likes/MyLikesPage.tsx', width: 'wide' },
  ProfilePage: { file: 'features/profile/ProfilePage.tsx', width: 'narrow' },
  ChatListPage: { file: 'features/chat/ChatListPage.tsx', width: 'default' },
  ChatThreadPage: { file: 'features/chat/ChatThreadPage.tsx', width: 'default' },
  MyFlatsPage: { file: 'features/flatmates/MyFlatsPage.tsx', width: 'default' },
  KitPreview: { file: 'app/KitPreview.tsx', width: 'wide' },
};

const GUARDS: Record<string, { file: string; width: Width }> = {
  RequireOwner: { file: 'features/auth/RequireOwner.tsx', width: 'default' },
  RequireSeeker: { file: 'features/auth/RequireSeeker.tsx', width: 'default' },
  RequireUser: { file: 'features/auth/RequireUser.tsx', width: 'default' },
};

/** Page roots a routed component renders, rather than routes.tsx itself (spec 0009a). */
const INNER: Record<string, { file: string; width: Width }> = {
  LandingPage: { file: 'features/landing/LandingPage.tsx', width: 'wide' },
};

/** The opening `<PageContainer …>` tags of a file (to their `>`, skipping `{…}` expressions). */
function openingTags(text: string): string[] {
  const tags: string[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf('<PageContainer', from);
    if (start < 0) return tags;
    let depth = 0;
    let end = start;
    for (; end < text.length; end++) {
      const c = text[end];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    tags.push(text.slice(start, end + 1));
    from = end + 1;
  }
}

/** The class text a tag's `className` resolves to: literals, plus any `const` it names. */
function classText(tag: string, file: string): string {
  const at = tag.indexOf('className=');
  if (at < 0) return '';
  const value = tag.slice(at + 'className='.length);
  if (value.startsWith('"')) return value.slice(1, value.indexOf('"', 1));
  // A `{…}` expression, to its matching brace.
  let depth = 0;
  let end = 0;
  for (; end < value.length; end++) {
    if (value[end] === '{') depth++;
    else if (value[end] === '}' && --depth === 0) break;
  }
  const expr = value.slice(1, end);
  const parts = [...expr.matchAll(/['"`]([^'"`]*)['"`]/g)].map((m) => m[1] ?? '');
  for (const [, name] of expr.matchAll(/\b([A-Za-z_]\w*)\b/g)) {
    const decl = new RegExp(`const ${name ?? ''} =\\s*['"\`]([^'"\`]*)['"\`]`).exec(file);
    if (decl !== null) parts.push(decl[1] ?? '');
  }
  return parts.join(' ');
}

describe('page roots', () => {
  it('ac4_page_roots_use_page_container', () => {
    const wrong: string[] = [];
    for (const [name, { file, width }] of Object.entries({ ...PAGES, ...GUARDS, ...INNER })) {
      const text = read(file);
      const tags = openingTags(text);
      // (a) A PageContainer, at the table's width.
      if (tags.length === 0) wrong.push(`${name}: no <PageContainer`);
      for (const [, w] of text.matchAll(/\bwidth="(narrow|default|wide)"/g)) {
        if (w !== width) wrong.push(`${name}: width="${w ?? ''}", expected ${width}`);
      }
      if (width !== 'default' && !text.includes(`width="${width}"`)) {
        wrong.push(`${name}: no width="${width}"`);
      }
      // (c) The page column's classes only: PageContainer owns the width and centring.
      for (const tag of tags) {
        const classes = classText(tag, text);
        for (const banned of [/\bmx-auto\b/, /\bw-full\b/, /\bmax-w-/]) {
          if (banned.test(classes)) wrong.push(`${name}: ${tag} has ${banned.source}`);
        }
      }
    }
    expect(wrong).toEqual([]);

    // (b) The table covers exactly the pages routes.tsx imports from ../features/ (minus the
    // guards), plus the dev-only kit.
    const routes = read('app/routes.tsx');
    const imported = [...routes.matchAll(/import \{ (\w+) \} from '\.\.\/features\//g)].map(
      (m) => m[1] ?? '',
    );
    const guards = imported.filter((n) => n in GUARDS);
    expect(guards.sort()).toEqual(Object.keys(GUARDS).sort());
    expect([...imported.filter((n) => !(n in GUARDS)), 'KitPreview'].sort()).toEqual(
      Object.keys(PAGES).sort(),
    );
  });
});
