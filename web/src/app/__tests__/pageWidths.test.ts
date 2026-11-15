import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

type Width = 'narrow' | 'default' | 'wide';
/** A page root at one width, a layout that switches between several (spec 0009s), or a page
 * rendered inside its layout's `PageContainer` (`'inLayout'`: it has none of its own). */
type TableWidth = Width | Width[] | 'inLayout';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file: string) => readFileSync(join(src, file), 'utf8');

/** Every routed page (spec 0009h §2), by the component `app/routes.tsx` imports. */
const PAGES: Record<string, { file: string; width: TableWidth }> = {
  // `/`: its pending state; the landing itself is in INNER.
  HomeRoute: { file: 'features/landing/HomeRoute.tsx', width: 'default' },
  LoginPage: { file: 'features/auth/LoginPage.tsx', width: 'narrow' },
  SignupPage: { file: 'features/auth/SignupPage.tsx', width: 'narrow' },
  SearchPage: { file: 'features/search/SearchPage.tsx', width: 'wide' },
  ListingPage: { file: 'features/listings/ListingPage.tsx', width: 'wide' },
  JoinFlatPage: { file: 'features/flatmates/JoinFlatPage.tsx', width: 'narrow' },
  NewListingPage: { file: 'features/listings/NewListingPage.tsx', width: 'wide' },
  MyListingsPage: { file: 'features/listings/MyListingsPage.tsx', width: 'wide' },
  EditListingPage: { file: 'features/listings/EditListingPage.tsx', width: 'wide' },
  ApplicantsPage: { file: 'features/applicants/ApplicantsPage.tsx', width: 'wide' },
  PeoplePage: { file: 'features/people/PeoplePage.tsx', width: 'wide' },
  FlatmatesPage: { file: 'features/flatmates/FlatmatesPage.tsx', width: 'default' },
  MyApplicationsPage: { file: 'features/applications/MyApplicationsPage.tsx', width: 'default' },
  // One width for both panels (spec 0010b), so switching tabs never moves the tablist; the
  // applications keep their reading column inside it.
  MarketMinePage: { file: 'features/market/MarketMinePage.tsx', width: 'wide' },
  MarketPeoplePage: { file: 'features/people/MarketPeoplePage.tsx', width: 'wide' },
  MyLikesPage: { file: 'features/likes/MyLikesPage.tsx', width: 'wide' },
  ProfilePage: { file: 'features/profile/ProfilePage.tsx', width: 'wide' },
  // Static pages (spec 0013f).
  LegalPage: { file: 'features/legal/LegalPage.tsx', width: 'narrow' },
  AccountDeletedPage: { file: 'features/profile/AccountDeletedPage.tsx', width: 'narrow' },
  // The phone's column and the desktop's two panes (spec 0009s); the pages sit inside it.
  ChatLayout: { file: 'features/chat/ChatLayout.tsx', width: ['default', 'wide'] },
  ChatListPage: { file: 'features/chat/ChatListPage.tsx', width: 'inLayout' },
  ChatThreadPage: { file: 'features/chat/ChatThreadPage.tsx', width: 'inLayout' },
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
      // (a) Inside its layout: no PageContainer of its own (no double gutters).
      if (width === 'inLayout') {
        if (tags.length > 0) wrong.push(`${name}: a <PageContainer inside its layout's`);
        continue;
      }
      // (a) A PageContainer, at the table's width (each of a layout's widths).
      const widths: Width[] = Array.isArray(width) ? width : [width];
      if (tags.length === 0) wrong.push(`${name}: no <PageContainer`);
      for (const [, w] of text.matchAll(/\bwidth="(narrow|default|wide)"/g)) {
        if (!widths.includes(w as Width)) {
          wrong.push(`${name}: width="${w ?? ''}", expected ${widths.join(' or ')}`);
        }
      }
      for (const w of widths) {
        if ((w !== 'default' || widths.length > 1) && !text.includes(`width="${w}"`)) {
          wrong.push(`${name}: no width="${w}"`);
        }
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
